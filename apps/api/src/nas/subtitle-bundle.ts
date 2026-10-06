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
 * Lance FFmpeg en arrière-plan et publie toutes les 2 s sur stderr sa position de lecture dans
 * le fichier source (`readpos=<positions des fd>/<taille>`, lue dans /proc/<pid>/fdinfo). Les
 * sous-titres étant entrelacés dans tout le fichier, FFmpeg doit le lire en entier : cette
 * position est la seule progression fiable (`out_time` reste à zéro jusqu'au 1er sous-titre).
 * Si la connexion SSH tombe (écriture stderr → SIGPIPE) ou en cas de timeout, FFmpeg est tué
 * au lieu de continuer à lire des dizaines de Go pour rien. Le code de sortie est celui de FFmpeg.
 * `lowPriority` : CPU/IO au plus bas, pour ne pas faire saccader la TV qui lit le même fichier.
 */
export function buildFfmpegWithReadProgress(ffmpegArgs: string, opts: { lowPriority?: boolean } = {}): string[] {
  return [
    'PID=""',
    `trap '[ -n "$PID" ] && kill "$PID" 2>/dev/null; [ -n "$TMP" ] && rm -rf "$TMP"' EXIT HUP INT TERM PIPE`,
    opts.lowPriority
      ? 'LOW=""; command -v nice >/dev/null 2>&1 && LOW="nice -n 19"; command -v ionice >/dev/null 2>&1 && LOW="$LOW ionice -c2 -n7"'
      : 'LOW=""',
    // nice/ionice font un exec : $! est bien le PID de FFmpeg
    `$LOW "$FF" -nostdin -v error -progress pipe:2 -i "$F" ${ffmpegArgs} &`,
    'PID=$!',
    'SIZE=$(stat -c %s "$F" 2>/dev/null)',
    `while kill -0 "$PID" 2>/dev/null; do echo "readpos=$(cat /proc/$PID/fdinfo/* 2>/dev/null | sed -n 's/^pos:[[:space:]]*//p' | tr '\\n' ' ')/$SIZE" >&2; sleep 2; done`,
    'wait "$PID"; RC=$?; PID=""',
    '[ "$RC" -eq 0 ] || exit "$RC"',
  ];
}

/**
 * Lignes shell à exécuter sur le NAS une fois `$FF` (binaire FFmpeg) et `$F` (fichier) définis.
 * Le code de sortie est celui de FFmpeg : si une seule piste échoue, FFmpeg s'arrête et on ne
 * renvoie rien (jamais de sous-titre tronqué en cache) — l'extraction à la demande prend alors
 * le relais piste par piste.
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
    ...buildFfmpegWithReadProgress(maps, { lowPriority: true }),
    dump,
  ];
}

/** Extraction d'une seule piste vers stdout (à la demande : priorité normale, l'utilisateur attend). */
export function buildSingleTrackExtractionScript(track: BundleTrack): string[] {
  return buildFfmpegWithReadProgress(`-map 0:s:${track.idx} ${OUTPUT_ARGS[track.format]} pipe:1`);
}

/**
 * Progression (%) depuis un morceau de stderr : position de lecture (`readpos=`) si disponible,
 * sinon `out_time` de FFmpeg rapporté à la durée du média. `null` si le morceau n'en contient pas.
 */
export function parseExtractionProgress(chunk: string, durationSeconds: number): number | null {
  const reads = chunk.match(/readpos=[\d ]*\/\d+/g);
  if (reads) {
    const m = /readpos=([\d ]*)\/(\d+)/.exec(reads[reads.length - 1])!;
    const size = Number(m[2]);
    // La plus grande position parmi les fd ouverts = le fichier source (sorties et pipes restent petits)
    const pos = Math.max(0, ...m[1].trim().split(/\s+/).filter(Boolean).map(Number));
    if (size > 0) return Math.min(99, Math.floor((pos / size) * 100));
  }
  const times = chunk.match(/out_time=(\d+):(\d+):(\d+)/g);
  if (!times || durationSeconds <= 0) return null;
  const last = /out_time=(\d+):(\d+):(\d+)/.exec(times[times.length - 1])!;
  const seconds = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
  return Math.min(99, Math.floor((seconds / durationSeconds) * 100));
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
