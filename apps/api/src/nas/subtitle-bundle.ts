// Extraction groupée des sous-titres : une seule passe FFmpeg sur le NAS écrit chaque piste
// texte dans un fichier temporaire, puis le script les restitue sur stdout séparées par un
// marqueur. Évite de relire (démuxer) tout le fichier une fois par piste.

export const SUBTITLE_BUNDLE_MARKER = '@@NASFLIX_TRACK';

// Sous-titres texte (convertibles en WebVTT) vs image (PGS/VOBSUB → OCR requis, non supporté).
// Même liste que apps/tv/src/hooks/utils.ts.
const TEXT_SUBTITLE_CODECS = new Set(['SUBRIP', 'SRT', 'ASS', 'SSA', 'MOV_TEXT', 'WEBVTT', 'VTT', 'TEXT']);

export function isTextSubtitleCodec(codec: string): boolean {
  return TEXT_SUBTITLE_CODECS.has((codec || '').toUpperCase());
}

/**
 * Lignes shell à exécuter sur le NAS une fois `$FF` (binaire FFmpeg) et `$F` (fichier) définis.
 * Le code de sortie est celui de FFmpeg : si une seule piste échoue à la conversion, FFmpeg
 * s'arrête et on ne renvoie rien (jamais de VTT tronqué en cache) — l'extraction à la demande
 * prend alors le relais piste par piste.
 */
export function buildBundleExtractionScript(trackIdxs: number[]): string[] {
  const maps = trackIdxs
    .map((idx) => `-map 0:s:${idx} -c:s webvtt -f webvtt "$TMP/${idx}.vtt"`)
    .join(' ');
  const dump = trackIdxs
    .map((idx) => `echo "${SUBTITLE_BUNDLE_MARKER} ${idx}"; cat "$TMP/${idx}.vtt"; echo`)
    .join('; ');
  return [
    'TMP=$(mktemp -d) || exit 44',
    `trap 'rm -rf "$TMP"' EXIT HUP INT TERM`,
    `"$FF" -nostdin -v error -progress pipe:2 -i "$F" ${maps} || exit $?`,
    dump,
  ];
}

/** Découpe la sortie du script ci-dessus en VTT par index de piste (les blocs invalides sont ignorés). */
export function parseSubtitleBundle(stdout: string): Map<number, string> {
  const tracks = new Map<number, string>();
  const parts = stdout.split(new RegExp(`^${SUBTITLE_BUNDLE_MARKER} (\\d+)\\r?$`, 'm'));
  // parts = [préambule, idx, contenu, idx, contenu, …]
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const vtt = parts[i + 1].trim();
    if (vtt.startsWith('WEBVTT')) tracks.set(Number(parts[i]), vtt);
  }
  return tracks;
}
