import { describe, expect, it } from 'vitest';
import { buildBundleExtractionScript, isTextSubtitleCodec, parseSubtitleBundle, SUBTITLE_BUNDLE_MARKER } from './subtitle-bundle';

describe('isTextSubtitleCodec', () => {
  it('accepte les codecs texte, insensible à la casse', () => {
    expect(isTextSubtitleCodec('SUBRIP')).toBe(true);
    expect(isTextSubtitleCodec('ass')).toBe(true);
  });

  it('refuse les codecs image et les valeurs vides', () => {
    expect(isTextSubtitleCodec('HDMV_PGS_SUBTITLE')).toBe(false);
    expect(isTextSubtitleCodec('DVD_SUBTITLE')).toBe(false);
    expect(isTextSubtitleCodec('')).toBe(false);
  });
});

describe('parseSubtitleBundle', () => {
  const vtt = (text: string) => `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${text}`;

  it('sépare les pistes par index', () => {
    const out = [
      `${SUBTITLE_BUNDLE_MARKER} 0`, vtt('Bonjour'), '',
      `${SUBTITLE_BUNDLE_MARKER} 2`, vtt('Hello'), '',
    ].join('\n');
    const tracks = parseSubtitleBundle(out);
    expect([...tracks.keys()]).toEqual([0, 2]);
    expect(tracks.get(0)).toBe(vtt('Bonjour'));
    expect(tracks.get(2)).toBe(vtt('Hello'));
  });

  it('ignore les blocs qui ne sont pas du WebVTT', () => {
    const out = [`${SUBTITLE_BUNDLE_MARKER} 0`, '', `${SUBTITLE_BUNDLE_MARKER} 1`, vtt('ok')].join('\n');
    expect([...parseSubtitleBundle(out).keys()]).toEqual([1]);
  });

  it('renvoie une map vide sans marqueur', () => {
    expect(parseSubtitleBundle('').size).toBe(0);
    expect(parseSubtitleBundle('NOFILE').size).toBe(0);
  });

  it('tolère les fins de ligne CRLF', () => {
    const out = `${SUBTITLE_BUNDLE_MARKER} 3\r\n${vtt('x')}\r\n`;
    expect(parseSubtitleBundle(out).has(3)).toBe(true);
  });
});

describe('buildBundleExtractionScript', () => {
  it('mappe chaque piste vers son propre fichier et les restitue toutes', () => {
    const script = buildBundleExtractionScript([0, 3]).join('\n');
    expect(script).toContain('-map 0:s:0 -c:s webvtt -f webvtt "$TMP/0.vtt"');
    expect(script).toContain('-map 0:s:3 -c:s webvtt -f webvtt "$TMP/3.vtt"');
    expect(script).toContain(`echo "${SUBTITLE_BUNDLE_MARKER} 3"`);
  });

  it('abandonne sans rien restituer si FFmpeg échoue (pas de VTT tronqué)', () => {
    const lines = buildBundleExtractionScript([0]);
    const ffmpegLine = lines.findIndex((l) => l.includes('"$FF"'));
    expect(lines[ffmpegLine]).toContain('|| exit $?');
    expect(ffmpegLine).toBeLessThan(lines.findIndex((l) => l.includes('cat "$TMP/0.vtt"')));
  });
});
