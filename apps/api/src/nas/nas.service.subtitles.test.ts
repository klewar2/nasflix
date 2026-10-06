import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NasService } from './nas.service';
import type { SubtitleTrackInfo } from './nas.service';
import type { BundleTrack } from './subtitle-bundle';

const vtt = (text: string) => `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${text}`;
const sup = (tag: number) => Buffer.from([0x50, 0x47, 0x00, tag]);

const TRACKS: SubtitleTrackInfo[] = [
  { index: 0, language: 'fre', title: 'Français', codec: 'SUBRIP' },
  { index: 1, language: 'eng', title: 'English', codec: 'ASS' },
  { index: 2, language: 'fre', title: 'Français', codec: 'HDMV_PGS_SUBTITLE' },
  { index: 3, language: 'ger', title: 'Deutsch', codec: 'HDMV_PGS_SUBTITLE' }, // PGS hors fr/en : à la demande seulement
  { index: 4, language: 'eng', title: 'English', codec: 'DVD_SUBTITLE' }, // image non supportée : jamais extraite
];

type Where = { mediaId?: number; episodeId?: number; trackIdx?: number };
interface Row { mediaId?: number; episodeId?: number; trackIdx: number; language: string; codec: string; title?: string; vttContent?: string; data?: Uint8Array }

function table() {
  const rows: Row[] = [];
  const match = (r: Row, where: Where) =>
    (where.mediaId === undefined || r.mediaId === where.mediaId)
    && (where.episodeId === undefined || r.episodeId === where.episodeId)
    && (where.trackIdx === undefined || r.trackIdx === where.trackIdx);
  return {
    rows,
    findFirst: vi.fn(async ({ where }: { where: Where }) => rows.find((r) => match(r, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Where }) => rows.filter((r) => match(r, where))),
    create: vi.fn(async ({ data }: { data: Row }) => { rows.push(data); return data; }),
    createMany: vi.fn(async ({ data }: { data: Row[] }) => { rows.push(...data); return { count: data.length }; }),
    deleteMany: vi.fn(async ({ where }: { where: Where }) => {
      for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], where)) rows.splice(i, 1);
    }),
  };
}

function setup() {
  const vttTable = table();
  const imageTable = table();
  const prisma = {
    media: { findFirst: vi.fn(async (): Promise<unknown> => ({ id: 1, nasPath: '/video/films/a.mkv', runtime: 100 })) },
    episode: { findFirst: vi.fn(async (): Promise<unknown> => ({ id: 1, nasPath: '/video/series/s01e01.mkv', runtime: 40 })) },
    subtitleCache: vttTable,
    subtitleImageCache: imageTable,
  };
  const service = new NasService(prisma as any, {} as any, {} as any, {} as any);
  const internals = service as any;
  internals.extractSubtitleBundleViaNasSsh = vi.fn(async (_c: number, _p: string, tracks: BundleTrack[]) =>
    new Map(tracks.map((t) => [t.idx, t.format === 'vtt' ? Buffer.from(vtt(`piste ${t.idx}`)) : sup(t.idx)])));
  internals.extractSubtitleTrackViaNasSsh = vi.fn(async (_c: number, _p: string, idx: number) => vtt(`seule ${idx}`));
  internals.extractImageSubtitleTrackViaNasSsh = vi.fn(async (_c: number, _p: string, idx: number) => sup(100 + idx));
  internals.probeTracksViaNasSsh = vi.fn(async () => ({ audio: [], subtitles: TRACKS }));
  return { service, internals, rows: vttTable.rows, imageRows: imageTable.rows, prisma };
}

/** Laisse les promesses d'arrière-plan (extraction fire-and-forget) se terminer. */
const flush = () => new Promise((r) => setTimeout(r, 10));

describe('pré-extraction des sous-titres', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });

  it('extrait en une seule passe les pistes texte (VTT) et les PGS fr/en (.sup)', async () => {
    await ctx.service.prefetchSubtitlesForMedia(1, 1, TRACKS);

    expect(ctx.internals.extractSubtitleBundleViaNasSsh).toHaveBeenCalledTimes(1);
    expect(ctx.internals.extractSubtitleBundleViaNasSsh.mock.calls[0][2]).toEqual([
      { idx: 0, format: 'vtt' }, { idx: 1, format: 'vtt' }, { idx: 2, format: 'sup' },
    ]);
    expect(ctx.rows.map((r) => [r.mediaId, r.trackIdx, r.language, r.codec])).toEqual([
      [1, 0, 'fre', 'SUBRIP'],
      [1, 1, 'eng', 'ASS'],
    ]);
    expect(ctx.imageRows.map((r) => [r.mediaId, r.trackIdx, r.language, Buffer.from(r.data!).equals(sup(2))])).toEqual([
      [1, 2, 'fre', true],
    ]);
  });

  it("n'extrait que les pistes manquantes, et rien si tout est déjà en cache", async () => {
    ctx.rows.push({ mediaId: 1, trackIdx: 0, language: 'fre', title: 'Français', codec: 'SUBRIP', vttContent: vtt('déjà là') });
    ctx.imageRows.push({ mediaId: 1, trackIdx: 2, language: 'fre', codec: 'HDMV_PGS_SUBTITLE', data: sup(9) });
    await ctx.service.prefetchSubtitlesForMedia(1, 1, TRACKS);
    expect(ctx.internals.extractSubtitleBundleViaNasSsh.mock.calls[0][2]).toEqual([{ idx: 1, format: 'vtt' }]);
    expect(ctx.rows.find((r) => r.trackIdx === 0)?.vttContent).toBe(vtt('déjà là'));

    await ctx.service.prefetchSubtitlesForMedia(1, 1, TRACKS);
    expect(ctx.internals.extractSubtitleBundleViaNasSsh).toHaveBeenCalledTimes(1);
  });

  it("n'écrit pas un contenu invalide renvoyé par l'extraction", async () => {
    ctx.internals.extractSubtitleBundleViaNasSsh.mockResolvedValueOnce(new Map([[0, Buffer.from('pas du vtt')], [2, Buffer.from('pas du pgs')]]));
    await ctx.service.prefetchSubtitlesForMedia(1, 1, TRACKS);
    expect(ctx.rows).toHaveLength(0);
    expect(ctx.imageRows).toHaveLength(0);
  });

  it('ne lance pas deux pré-extractions concurrentes pour le même média', async () => {
    await Promise.all([
      ctx.service.prefetchSubtitlesForMedia(1, 1, TRACKS),
      ctx.service.prefetchSubtitlesForMedia(1, 1, TRACKS),
    ]);
    expect(ctx.internals.extractSubtitleBundleViaNasSsh).toHaveBeenCalledTimes(1);
  });

  it("ne lève jamais et n'écrit rien si l'extraction échoue, puis laisse un délai avant de réessayer", async () => {
    ctx.internals.extractSubtitleBundleViaNasSsh.mockRejectedValueOnce(new Error('NOFFMPEG'));
    await expect(ctx.service.prefetchSubtitlesForMedia(1, 1, TRACKS)).resolves.toBeUndefined();
    expect(ctx.rows).toHaveLength(0);

    await ctx.service.prefetchSubtitlesForMedia(1, 1, TRACKS);
    expect(ctx.internals.extractSubtitleBundleViaNasSsh).toHaveBeenCalledTimes(1); // réessai différé
  });

  it('post-transfert : sonde via SSH, purge les caches périmés et ré-extrait (film)', async () => {
    ctx.prisma.episode.findFirst.mockResolvedValueOnce(null);
    ctx.prisma.media.findFirst.mockResolvedValueOnce({ id: 7, runtime: 90 });
    ctx.rows.push({ mediaId: 7, trackIdx: 0, language: 'fre', title: 'Français', codec: 'SUBRIP', vttContent: vtt('ancien fichier') });
    ctx.imageRows.push({ mediaId: 7, trackIdx: 2, language: 'fre', codec: 'HDMV_PGS_SUBTITLE', data: sup(0xee) });

    await ctx.service.prefetchSubtitlesForNasPath(1, '/video/films/a.mkv');

    expect(ctx.internals.probeTracksViaNasSsh).toHaveBeenCalledTimes(1);
    expect(ctx.rows.map((r) => r.vttContent)).toEqual([vtt('piste 0'), vtt('piste 1')]);
    expect(ctx.imageRows.map((r) => Buffer.from(r.data!).equals(sup(2)))).toEqual([true]);
  });

  it("post-transfert : rattache les sous-titres à l'épisode, pas au média série", async () => {
    ctx.prisma.episode.findFirst.mockResolvedValueOnce({ id: 42, runtime: 40 });
    await ctx.service.prefetchSubtitlesForNasPath(1, '/video/series/s01e01.mkv');
    expect([...ctx.rows, ...ctx.imageRows].every((r) => r.episodeId === 42 && r.mediaId === undefined)).toBe(true);
    expect(ctx.prisma.media.findFirst).not.toHaveBeenCalled();
  });

  it('post-transfert sans entrée catalogue : ne fait rien', async () => {
    ctx.prisma.episode.findFirst.mockResolvedValueOnce(null);
    ctx.prisma.media.findFirst.mockResolvedValueOnce(null);
    await ctx.service.prefetchSubtitlesForNasPath(1, '/video/films/inconnu.mkv');
    expect(ctx.internals.probeTracksViaNasSsh).not.toHaveBeenCalled();
  });
});

describe("coexistence avec l'extraction à la demande (VTT)", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });
  const meta = { language: 'fre', title: 'Français', codec: 'SUBRIP' };

  it('sans pré-extraction : comportement inchangé (pending puis cache)', async () => {
    const first = await ctx.service.getNasSubtitleTrackForMedia(1, 0, 1, 1, meta);
    expect(first.pending).toBe(true);
    await flush();
    expect(ctx.internals.extractSubtitleTrackViaNasSsh).toHaveBeenCalledTimes(1);

    const second = await ctx.service.getNasSubtitleTrackForMedia(1, 0, 1, 1, meta);
    expect(second.pending).toBeUndefined();
    expect(second.vttContent).toBe(vtt('seule 0'));
  });

  it('pré-extraction en cours : la demande attend (pending) sans relire le fichier, puis cache hit', async () => {
    let release!: () => void;
    ctx.internals.extractSubtitleBundleViaNasSsh.mockImplementationOnce((_c: number, _p: string, tracks: BundleTrack[]) =>
      new Promise((resolve) => { release = () => resolve(new Map(tracks.map((t) => [t.idx, Buffer.from(vtt(`piste ${t.idx}`))]))); }));

    const prefetch = ctx.service.prefetchSubtitlesForMedia(1, 1, TRACKS);
    await flush();

    const during = await ctx.service.getNasSubtitleTrackForMedia(1, 1, 1, 1, meta);
    expect(during.pending).toBe(true);
    expect(ctx.internals.extractSubtitleTrackViaNasSsh).not.toHaveBeenCalled();

    release();
    await prefetch;

    const after = await ctx.service.getNasSubtitleTrackForMedia(1, 1, 1, 1, meta);
    expect(after.pending).toBeUndefined();
    expect(after.vttContent).toBe(vtt('piste 1'));
    expect(ctx.internals.extractSubtitleTrackViaNasSsh).not.toHaveBeenCalled();
  });

  it("pré-extraction échouée : l'extraction à la demande prend le relais", async () => {
    ctx.internals.extractSubtitleBundleViaNasSsh.mockRejectedValueOnce(new Error('SSH KO'));
    await ctx.service.prefetchSubtitlesForMedia(1, 1, TRACKS);

    const res = await ctx.service.getNasSubtitleTrackForMedia(1, 0, 1, 1, meta);
    expect(res.pending).toBe(true);
    await flush();
    expect(ctx.internals.extractSubtitleTrackViaNasSsh).toHaveBeenCalledTimes(1);
    expect(ctx.rows.map((r) => r.vttContent)).toEqual([vtt('seule 0')]);
  });

  it('extraction à la demande en cours : la pré-extraction ne relit pas le fichier en double', async () => {
    let release!: () => void;
    ctx.internals.extractSubtitleTrackViaNasSsh.mockImplementationOnce(() =>
      new Promise((resolve) => { release = () => resolve(vtt('seule 0')); }));

    await ctx.service.getNasSubtitleTrackForMedia(1, 0, 1, 1, meta);
    await ctx.service.prefetchSubtitlesForMedia(1, 1, TRACKS);
    expect(ctx.internals.extractSubtitleBundleViaNasSsh).not.toHaveBeenCalled();

    release();
    await flush();
  });
});

describe('sous-titres image (PGS) à la demande', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });
  const meta = { language: 'ger', codec: 'HDMV_PGS_SUBTITLE' };

  it('extrait en arrière-plan (pending), puis renvoie ready et les données', async () => {
    const first = await ctx.service.getNasImageSubtitleForMedia(1, 3, 1, meta);
    expect(first).toMatchObject({ trackIdx: 3, ready: false, pending: true });
    await flush();
    expect(ctx.internals.extractImageSubtitleTrackViaNasSsh).toHaveBeenCalledTimes(1);

    const second = await ctx.service.getNasImageSubtitleForMedia(1, 3, 1, meta);
    expect(second).toEqual({ trackIdx: 3, language: 'ger', codec: 'HDMV_PGS_SUBTITLE', ready: true });

    const data = await ctx.service.getNasImageSubtitleDataForMedia(1, 3, 1);
    expect(Buffer.from(data).equals(sup(103))).toBe(true);
  });

  it('épisode : même cycle, rattaché à l\'épisode', async () => {
    await ctx.service.getNasImageSubtitleForEpisode(5, 3, 1, meta);
    await flush();
    expect(ctx.imageRows.map((r) => [r.episodeId, r.mediaId, r.trackIdx])).toEqual([[5, undefined, 3]]);
    expect(Buffer.from(await ctx.service.getNasImageSubtitleDataForEpisode(5, 3, 1)).equals(sup(103))).toBe(true);
  });

  it('refuse les codecs image autres que PGS', async () => {
    await expect(ctx.service.getNasImageSubtitleForMedia(1, 4, 1, { language: 'eng', codec: 'DVD_SUBTITLE' }))
      .rejects.toThrow(/non supporté/);
    expect(ctx.internals.extractImageSubtitleTrackViaNasSsh).not.toHaveBeenCalled();
  });

  it("remonte l'échec d'extraction au poll suivant, une seule fois", async () => {
    ctx.internals.extractImageSubtitleTrackViaNasSsh.mockRejectedValueOnce(new Error('NOFFMPEG'));
    await ctx.service.getNasImageSubtitleForMedia(1, 3, 1, meta);
    await flush();
    await expect(ctx.service.getNasImageSubtitleForMedia(1, 3, 1, meta)).rejects.toThrow(/NOFFMPEG/);
    expect((await ctx.service.getNasImageSubtitleForMedia(1, 3, 1, meta)).pending).toBe(true); // nouvel essai
  });

  it('pré-extraction en cours : attend (pending) sans lancer sa propre extraction', async () => {
    let release!: () => void;
    ctx.internals.extractSubtitleBundleViaNasSsh.mockImplementationOnce((_c: number, _p: string, tracks: BundleTrack[]) =>
      new Promise((resolve) => { release = () => resolve(new Map(tracks.map((t) => [t.idx, t.format === 'sup' ? sup(t.idx) : Buffer.from(vtt('x'))]))); }));

    const prefetch = ctx.service.prefetchSubtitlesForMedia(1, 1, TRACKS);
    await flush();
    const during = await ctx.service.getNasImageSubtitleForMedia(1, 2, 1, { language: 'fre', codec: 'HDMV_PGS_SUBTITLE' });
    expect(during.pending).toBe(true);

    release();
    await prefetch;
    expect((await ctx.service.getNasImageSubtitleForMedia(1, 2, 1, { language: 'fre', codec: 'HDMV_PGS_SUBTITLE' })).ready).toBe(true);
    expect(ctx.internals.extractImageSubtitleTrackViaNasSsh).not.toHaveBeenCalled();
  });

  it("données : 404 tant que la piste n'est pas extraite, et vérifie le CineClub", async () => {
    await expect(ctx.service.getNasImageSubtitleDataForMedia(1, 3, 1)).rejects.toThrow(/non extrait/);

    ctx.imageRows.push({ mediaId: 1, trackIdx: 3, language: 'ger', codec: 'HDMV_PGS_SUBTITLE', data: sup(1) });
    ctx.prisma.media.findFirst.mockResolvedValueOnce(null); // média d'un autre club
    await expect(ctx.service.getNasImageSubtitleDataForMedia(1, 3, 2)).rejects.toThrow(/introuvable/);
  });
});
