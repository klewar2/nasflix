import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NasService } from './nas.service';
import type { SubtitleTrackInfo } from './nas.service';

const vtt = (text: string) => `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${text}`;

const TRACKS: SubtitleTrackInfo[] = [
  { index: 0, language: 'fre', title: 'Français', codec: 'SUBRIP' },
  { index: 1, language: 'eng', title: 'English', codec: 'ASS' },
  { index: 2, language: 'eng', title: 'English', codec: 'HDMV_PGS_SUBTITLE' }, // image : jamais extraite
];

interface Row { mediaId?: number; episodeId?: number; trackIdx: number; language: string; title: string; codec: string; vttContent: string }

function setup() {
  const rows: Row[] = [];
  const match = (r: Row, where: { mediaId?: number; episodeId?: number; trackIdx?: number }) =>
    (where.mediaId === undefined || r.mediaId === where.mediaId)
    && (where.episodeId === undefined || r.episodeId === where.episodeId)
    && (where.trackIdx === undefined || r.trackIdx === where.trackIdx);

  const prisma = {
    media: { findFirst: vi.fn(async () => ({ nasPath: '/video/films/a.mkv', runtime: 100 })) },
    episode: { findFirst: vi.fn(async () => ({ nasPath: '/video/series/s01e01.mkv', runtime: 40 })) },
    subtitleCache: {
      findFirst: vi.fn(async ({ where }) => rows.find((r) => match(r, where)) ?? null),
      findMany: vi.fn(async ({ where }) => rows.filter((r) => match(r, where))),
      create: vi.fn(async ({ data }) => { rows.push(data); return data; }),
      createMany: vi.fn(async ({ data }) => { rows.push(...data); return { count: data.length }; }),
      deleteMany: vi.fn(async ({ where }) => {
        for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], where)) rows.splice(i, 1);
      }),
    },
  };
  const service = new NasService(prisma as any, {} as any, {} as any, {} as any);
  const internals = service as any;
  internals.extractSubtitleBundleViaNasSsh = vi.fn(async (_c: number, _p: string, idxs: number[]) =>
    new Map(idxs.map((i) => [i, vtt(`piste ${i}`)])));
  internals.extractSubtitleTrackViaNasSsh = vi.fn(async (_c: number, _p: string, idx: number) => vtt(`seule ${idx}`));
  internals.probeTracksViaNasSsh = vi.fn(async () => ({ audio: [], subtitles: TRACKS }));
  return { service, internals, rows, prisma };
}

/** Laisse les promesses d'arrière-plan (extraction fire-and-forget) se terminer. */
const flush = () => new Promise((r) => setTimeout(r, 10));

describe('pré-extraction des sous-titres', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });

  it('met en cache toutes les pistes texte en une seule passe, pas les pistes image', async () => {
    await ctx.service.prefetchSubtitlesForMedia(1, 1, TRACKS);

    expect(ctx.internals.extractSubtitleBundleViaNasSsh).toHaveBeenCalledTimes(1);
    expect(ctx.internals.extractSubtitleBundleViaNasSsh.mock.calls[0][2]).toEqual([0, 1]);
    expect(ctx.rows.map((r) => [r.mediaId, r.trackIdx, r.language, r.codec])).toEqual([
      [1, 0, 'fre', 'SUBRIP'],
      [1, 1, 'eng', 'ASS'],
    ]);
  });

  it("n'extrait que les pistes manquantes, et rien si tout est déjà en cache", async () => {
    ctx.rows.push({ mediaId: 1, trackIdx: 0, language: 'fre', title: 'Français', codec: 'SUBRIP', vttContent: vtt('déjà là') });
    await ctx.service.prefetchSubtitlesForMedia(1, 1, TRACKS);
    expect(ctx.internals.extractSubtitleBundleViaNasSsh.mock.calls[0][2]).toEqual([1]);
    expect(ctx.rows.find((r) => r.trackIdx === 0)?.vttContent).toBe(vtt('déjà là'));

    await ctx.service.prefetchSubtitlesForMedia(1, 1, TRACKS);
    expect(ctx.internals.extractSubtitleBundleViaNasSsh).toHaveBeenCalledTimes(1);
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

  it('post-transfert : sonde via SSH, purge le cache périmé et ré-extrait (film)', async () => {
    ctx.prisma.episode.findFirst.mockResolvedValueOnce(null as never);
    ctx.prisma.media.findFirst.mockResolvedValueOnce({ id: 7, runtime: 90 } as never);
    ctx.rows.push({ mediaId: 7, trackIdx: 0, language: 'fre', title: 'Français', codec: 'SUBRIP', vttContent: vtt('ancien fichier') });

    await ctx.service.prefetchSubtitlesForNasPath(1, '/video/films/a.mkv');

    expect(ctx.internals.probeTracksViaNasSsh).toHaveBeenCalledTimes(1);
    expect(ctx.rows.map((r) => r.vttContent)).toEqual([vtt('piste 0'), vtt('piste 1')]);
  });

  it('post-transfert : rattache les sous-titres à l\'épisode, pas au média série', async () => {
    ctx.prisma.episode.findFirst.mockResolvedValueOnce({ id: 42, runtime: 40 } as never);
    await ctx.service.prefetchSubtitlesForNasPath(1, '/video/series/s01e01.mkv');
    expect(ctx.rows.every((r) => r.episodeId === 42 && r.mediaId === undefined)).toBe(true);
    expect(ctx.prisma.media.findFirst).not.toHaveBeenCalled();
  });

  it('post-transfert sans entrée catalogue : ne fait rien', async () => {
    ctx.prisma.episode.findFirst.mockResolvedValueOnce(null as never);
    ctx.prisma.media.findFirst.mockResolvedValueOnce(null as never);
    await ctx.service.prefetchSubtitlesForNasPath(1, '/video/films/inconnu.mkv');
    expect(ctx.internals.probeTracksViaNasSsh).not.toHaveBeenCalled();
  });
});

describe('coexistence avec l\'extraction à la demande', () => {
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
    ctx.internals.extractSubtitleBundleViaNasSsh.mockImplementationOnce((_c: number, _p: string, idxs: number[]) =>
      new Promise((resolve) => { release = () => resolve(new Map(idxs.map((i) => [i, vtt(`piste ${i}`)]))); }));

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
