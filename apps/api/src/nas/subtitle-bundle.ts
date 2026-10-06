// Extraction groupée des sous-titres : une seule passe FFmpeg sur le NAS écrit chaque piste
// dans un fichier temporaire, puis le script les restitue sur stdout, chacune précédée d'un
// en-tête « marqueur index taille ». Le découpage par taille (et non par marqueur) rend le
// protocole sûr pour le binaire (PGS .sup). Évite de relire (démuxer) tout le fichier une
// fois par piste.

export const SUBTITLE_BUNDLE_MARKER = '@@NASFLIX_TRACK';

// Sous-titres texte (convertibles en WebVTT) vs image (PGS/VOBSUB → OCR requis).
// Même liste que apps/tv/src/hooks/utils.ts.
const TEXT_SUBTITLE_CODECS = new Set(['SUBRIP', 'SRT', 'ASS', 'SSA', 'MOV_TEXT', 'WEBVTT', 'VTT', 'TEXT']);

export function isTextSubtitleCodec(codec: string): boolean {
  return TEXT_SUBTITLE_CODECS.has((codec || '').toUpperCase());
}

/** PGS (Blu-ray) : extrait tel quel en .sup et rendu en image par l'app TV (libpgs). */
export function isPgsSubtitleCodec(codec: string): boolean {
  return (codec || '').toUpperCase() === 'HDMV_PGS_SUBTITLE';
}

/** Un fichier .sup commence par le magic « PG » de son premier segment. */
export function isPgsData(data: Buffer): boolean {
  return data.length > 2 && data[0] === 0x50 && data[1] === 0x47;
}

export type BundleFormat = 'vtt' | 'sup';

export interface BundleTrack {
  idx: number;
  format: BundleFormat;
}

const OUTPUT_ARGS: Record<BundleFormat, string> = {
  vtt: '-c:s webvtt -f webvtt',
  sup: '-c:s copy -f sup',
};

/**
 * Lignes shell à exécuter sur le NAS une fois `$FF` (binaire FFmpeg) et `$F` (fichier) définis.
 * Le code de sortie est celui de FFmpeg : si une seule piste échoue, FFmpeg s'arrête et on ne
 * renvoie rien (jamais de sous-titre tronqué en cache) — l'extraction à la demande prend alors
 * le relais piste par piste.
 * FFmpeg tourne en priorité CPU/IO basse : la lecture complète du fichier ne doit pas faire
 * saccader la TV qui lit le même fichier au même moment.
 */
export function buildBundleExtractionScript(tracks: BundleTrack[]): string[] {
  const file = (t: BundleTrack) => `"$TMP/${t.idx}.${t.format}"`;
  const maps = tracks
    .map((t) => `-map 0:s:${t.idx} ${OUTPUT_ARGS[t.format]} ${file(t)}`)
    .join(' ');
  const dump = tracks
    .map((t) => `printf '${SUBTITLE_BUNDLE_MARKER} ${t.idx} %s\\n' "$(wc -c < ${file(t)})"; cat ${file(t)}`)
    .join('; ');
  return [
    'TMP=$(mktemp -d) || exit 44',
    `trap 'rm -rf "$TMP"' EXIT HUP INT TERM`,
    'LOW=""; command -v nice >/dev/null 2>&1 && LOW="nice -n 19"; command -v ionice >/dev/null 2>&1 && LOW="$LOW ionice -c2 -n7"',
    `$LOW "$FF" -nostdin -v error -progress pipe:2 -i "$F" ${maps} || exit $?`,
    dump,
  ];
}

/**
 * Découpe la sortie du script ci-dessus en contenu brut par index de piste.
 * Un bloc tronqué (sortie coupée) arrête le découpage ; un en-tête invalide est ignoré.
 */
export function parseSubtitleBundle(stdout: Buffer): Map<number, Buffer> {
  const tracks = new Map<number, Buffer>();
  const marker = Buffer.from(`${SUBTITLE_BUNDLE_MARKER} `);
  let pos = 0;
  for (;;) {
    const start = stdout.indexOf(marker, pos);
    if (start < 0) break;
    const eol = stdout.indexOf(0x0a, start);
    if (eol < 0) break;
    // wc -c peut aligner la taille avec des espaces (BSD) → « + »
    const header = /^\S+ (\d+) +(\d+)\r?$/.exec(stdout.subarray(start, eol).toString('latin1'));
    if (!header) { pos = eol + 1; continue; }
    const size = Number(header[2]);
    const dataStart = eol + 1;
    if (dataStart + size > stdout.length) break;
    tracks.set(Number(header[1]), stdout.subarray(dataStart, dataStart + size));
    pos = dataStart + size;
  }
  return tracks;
}
