import { describe, expect, it } from 'vitest';
import {
  buildBundleExtractionScript, buildSingleTrackExtractionScript, isPgsData, isPgsSubtitleCodec, isTextSubtitleCodec,
  parseExtractionProgress, parseSubtitleBundle, SUBTITLE_BUNDLE_MARKER,
} from './subtitle-bundle';

describe('codecs', () => {
  it('accepte les codecs texte, insensible à la casse', () => {
    expect(isTextSubtitleCodec('SUBRIP')).toBe(true);
    expect(isTextSubtitleCodec('ass')).toBe(true);
  });

  it('refuse les codecs image et les valeurs vides comme texte', () => {
    expect(isTextSubtitleCodec('HDMV_PGS_SUBTITLE')).toBe(false);
    expect(isTextSubtitleCodec('DVD_SUBTITLE')).toBe(false);
    expect(isTextSubtitleCodec('')).toBe(false);
  });

  it('reconnaît le PGS (et seulement lui) comme image rendable', () => {
    expect(isPgsSubtitleCodec('HDMV_PGS_SUBTITLE')).toBe(true);
    expect(isPgsSubtitleCodec('hdmv_pgs_subtitle')).toBe(true);
    expect(isPgsSubtitleCodec('DVD_SUBTITLE')).toBe(false);
  });

  it('vérifie le magic « PG » des données .sup', () => {
    expect(isPgsData(Buffer.from([0x50, 0x47, 0x00, 0x01]))).toBe(true);
    expect(isPgsData(Buffer.from('WEBVTT'))).toBe(false);
    expect(isPgsData(Buffer.alloc(0))).toBe(false);
  });
});

/** Reproduit la sortie du script : en-tête « marqueur index taille » puis le contenu brut. */
function frame(idx: number, content: Buffer | string, sizePadding = ''): Buffer {
  const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  return Buffer.concat([Buffer.from(`${SUBTITLE_BUNDLE_MARKER} ${idx} ${sizePadding}${data.length}\n`), data]);
}

describe('parseSubtitleBundle', () => {
  const vtt = (text: string) => `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${text}`;

  it('sépare les pistes par index, accents compris (taille en octets)', () => {
    const tracks = parseSubtitleBundle(Buffer.concat([frame(0, vtt('Café à Noël')), frame(2, vtt('Hello'))]));
    expect([...tracks.keys()]).toEqual([0, 2]);
    expect(tracks.get(0)!.toString('utf8')).toBe(vtt('Café à Noël'));
    expect(tracks.get(2)!.toString('utf8')).toBe(vtt('Hello'));
  });

  it('est sûr pour le binaire, même si les données contiennent le marqueur ou des sauts de ligne', () => {
    const pgs = Buffer.concat([Buffer.from([0x50, 0x47, 0x0a, 0x00, 0xff]), Buffer.from(`\n${SUBTITLE_BUNDLE_MARKER} 9 3\n`)]);
    const tracks = parseSubtitleBundle(Buffer.concat([frame(1, pgs), frame(3, vtt('ok'))]));
    expect([...tracks.keys()]).toEqual([1, 3]);
    expect(tracks.get(1)!.equals(pgs)).toBe(true);
  });

  it('tolère une taille alignée par des espaces (wc -c BSD) et un préambule parasite', () => {
    const out = Buffer.concat([Buffer.from('bannière du shell\n'), frame(4, vtt('x'), '     ')]);
    expect(parseSubtitleBundle(out).get(4)!.toString()).toBe(vtt('x'));
  });

  it("s'arrête sur un bloc tronqué sans renvoyer de contenu partiel", () => {
    const full = frame(0, vtt('complet'));
    const truncated = frame(1, vtt('tronqué')).subarray(0, 30);
    const tracks = parseSubtitleBundle(Buffer.concat([full, truncated]));
    expect([...tracks.keys()]).toEqual([0]);
  });

  it('ignore un en-tête sans taille (fichier de sortie absent)', () => {
    const out = Buffer.concat([Buffer.from(`${SUBTITLE_BUNDLE_MARKER} 0 \n`), frame(1, vtt('ok'))]);
    expect([...parseSubtitleBundle(out).keys()]).toEqual([1]);
  });

  it('renvoie une map vide sans marqueur', () => {
    expect(parseSubtitleBundle(Buffer.alloc(0)).size).toBe(0);
    expect(parseSubtitleBundle(Buffer.from('NOFILE')).size).toBe(0);
  });
});

describe('buildBundleExtractionScript', () => {
  it('mappe chaque piste vers son propre fichier, au bon format', () => {
    const script = buildBundleExtractionScript([{ idx: 0, format: 'vtt' }, { idx: 3, format: 'sup' }]).join('\n');
    expect(script).toContain('-map 0:s:0 -c:s webvtt -f webvtt "$TMP/0.vtt"');
    expect(script).toContain('-map 0:s:3 -c:s copy -f sup "$TMP/3.sup"');
    expect(script).toContain(`printf '${SUBTITLE_BUNDLE_MARKER} 3 %s\\n' "$(wc -c < "$TMP/3.sup")"`);
  });

  it('abandonne sans rien restituer si FFmpeg échoue (pas de sous-titre tronqué)', () => {
    const lines = buildBundleExtractionScript([{ idx: 0, format: 'vtt' }]);
    const exitLine = lines.indexOf('[ "$RC" -eq 0 ] || exit "$RC"');
    expect(exitLine).toBeGreaterThan(lines.findIndex((l) => l.includes('"$FF"')));
    expect(exitLine).toBeLessThan(lines.findIndex((l) => l.includes('cat "$TMP/0.vtt"')));
  });

  it('pré-extraction en priorité basse, publie la position de lecture et tue FFmpeg si la session tombe', () => {
    const script = buildBundleExtractionScript([{ idx: 0, format: 'sup' }]).join('\n');
    expect(script).toContain('ionice -c2 -n7');
    expect(script).toContain('/proc/$PID/fdinfo/');
    expect(script).toMatch(/trap '.*kill "\$PID".*' EXIT HUP INT TERM PIPE/);
  });
});

describe('buildSingleTrackExtractionScript', () => {
  it('extrait une piste vers stdout, en priorité normale (l\'utilisateur attend)', () => {
    const script = buildSingleTrackExtractionScript({ idx: 2, format: 'sup' }).join('\n');
    expect(script).toContain('-map 0:s:2 -c:s copy -f sup pipe:1 &');
    expect(script).not.toContain('ionice');
    expect(script).toContain('readpos=');
  });
});

describe('parseExtractionProgress', () => {
  it('utilise la plus grande position de lecture rapportée à la taille du fichier', () => {
    // fd : stdin/stdout/stderr à 0, sortie .sup (petite), fichier source (grande position)
    expect(parseExtractionProgress('readpos=0 0 0 1048576 11324314443 /45293257775\n', 6720)).toBe(25);
  });

  it('prend la dernière mesure d\'un morceau qui en contient plusieurs', () => {
    expect(parseExtractionProgress('readpos=10 /100\nreadpos=50 /100\n', 0)).toBe(50);
  });

  it('plafonne à 99 % (100 % = extraction terminée et mise en cache)', () => {
    expect(parseExtractionProgress('readpos=100 /100\n', 0)).toBe(99);
  });

  it('retombe sur out_time sans taille connue (stat absent) ou sans readpos', () => {
    expect(parseExtractionProgress('readpos=500 /\nout_time=00:56:00.000000\n', 6720)).toBe(50);
    expect(parseExtractionProgress('out_time=00:11:12.000000\nprogress=continue\n', 6720)).toBe(10);
  });

  it('ignore out_time négatif (aucun paquet encore écrit) et les morceaux sans progression', () => {
    expect(parseExtractionProgress('out_time=-577014:32:22.775807\n', 6720)).toBeNull();
    expect(parseExtractionProgress('bitrate=N/A\n', 6720)).toBeNull();
    expect(parseExtractionProgress('out_time=00:10:00.000000\n', 0)).toBeNull();
  });
});
