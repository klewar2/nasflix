import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Job as JobRow, JobKind, JobSource, JobStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { JOBS_QUEUE } from './jobs.constants';
import { RadarrWebhookPayload, SonarrWebhookPayload } from './dto/webhook-radarr.dto';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @InjectQueue(JOBS_QUEUE) private readonly queue: Queue,
  ) {}

  async createDownloadJob(input: {
    cineClubId: number;
    source: JobSource;
    sourcePath: string;
    fileName: string;
    fileSize?: number | bigint | null;
    tmdbId?: number | null;
    tmdbType?: 'movie' | 'tv';
    seasonNumber?: number | null;
    episodeNumber?: number | null;
    mediaId?: number | null;
    episodeId?: number | null;
    triggeredBy?: string | null;
  }): Promise<JobRow> {
    const job = await this.prisma.job.create({
      data: {
        cineClubId: input.cineClubId,
        kind: JobKind.DOWNLOAD_TO_NAS,
        source: input.source,
        status: JobStatus.PENDING,
        sourcePath: input.sourcePath,
        fileName: input.fileName,
        fileSize: input.fileSize ? BigInt(input.fileSize) : null,
        tmdbId: input.tmdbId ?? null,
        tmdbType: input.tmdbType ?? null,
        seasonNumber: input.seasonNumber ?? null,
        episodeNumber: input.episodeNumber ?? null,
        mediaId: input.mediaId ?? null,
        episodeId: input.episodeId ?? null,
        triggeredBy: input.triggeredBy ?? null,
      },
    });
    await this.enqueueRun(job.id);
    return job;
  }

  async createSeedboxDeletionJob(input: {
    cineClubId: number;
    sourcePath: string;
    fileName: string;
    mediaId?: number | null;
    episodeId?: number | null;
    delayMs: number;
    triggeredBy?: string | null;
  }): Promise<JobRow> {
    const scheduledFor = new Date(Date.now() + input.delayMs);
    const job = await this.prisma.job.create({
      data: {
        cineClubId: input.cineClubId,
        kind: JobKind.DELETE_FROM_SEEDBOX,
        source: JobSource.NAS_SYNC,
        status: JobStatus.PENDING,
        sourcePath: input.sourcePath,
        fileName: input.fileName,
        mediaId: input.mediaId ?? null,
        episodeId: input.episodeId ?? null,
        scheduledFor,
        triggeredBy: input.triggeredBy ?? null,
      },
    });
    await this.enqueueRun(job.id, input.delayMs);
    return job;
  }

  async createJellyfinDeletionJob(input: {
    cineClubId: number;
    mediaId: number;
    jellyfinItemId: string;
    triggeredBy?: string | null;
  }): Promise<JobRow> {
    const job = await this.prisma.job.create({
      data: {
        cineClubId: input.cineClubId,
        kind: JobKind.DELETE_FROM_JELLYFIN,
        source: JobSource.MANUAL,
        status: JobStatus.PENDING,
        mediaId: input.mediaId,
        jellyfinItemId: input.jellyfinItemId,
        triggeredBy: input.triggeredBy ?? null,
      },
    });
    await this.enqueueRun(job.id);
    return job;
  }

  async cancel(id: number): Promise<JobRow> {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException(`Job ${id} introuvable`);
    const cancellable: JobStatus[] = [JobStatus.PENDING, JobStatus.AWAITING_NAS, JobStatus.AWAITING_SEEDBOX];
    if (!cancellable.includes(job.status)) {
      throw new BadRequestException(`Job ${id} ne peut plus être annulé (status=${job.status})`);
    }
    return this.prisma.job.update({
      where: { id },
      data: { status: JobStatus.CANCELLED, cancelledAt: new Date() },
    });
  }

  async retry(id: number): Promise<JobRow> {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException(`Job ${id} introuvable`);
    const retryable: JobStatus[] = [JobStatus.FAILED, JobStatus.CANCELLED];
    if (!retryable.includes(job.status)) {
      throw new BadRequestException(`Job ${id} ne peut être relancé que depuis FAILED/CANCELLED (status=${job.status})`);
    }
    const updated = await this.prisma.job.update({
      where: { id },
      data: {
        status: JobStatus.PENDING,
        errorMessage: null,
        errorDetails: Prisma.DbNull,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        progressPercent: null,
      },
    });
    await this.enqueueRun(id);
    return updated;
  }

  async list(params: {
    cineClubId: number;
    kind?: JobKind;
    status?: JobStatus;
    source?: JobSource;
    page: number;
    limit: number;
  }) {
    const where: Prisma.JobWhereInput = {
      cineClubId: params.cineClubId,
      ...(params.kind && { kind: params.kind }),
      ...(params.status && { status: params.status }),
      ...(params.source && { source: params.source }),
    };
    const [items, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.job.count({ where }),
    ]);
    return { items: items.map(serialize), total, page: params.page, limit: params.limit };
  }

  async getById(id: number, cineClubId: number) {
    const job = await this.prisma.job.findFirst({ where: { id, cineClubId } });
    if (!job) throw new NotFoundException(`Job ${id} introuvable`);
    return serialize(job);
  }

  async listActive(cineClubId: number) {
    const items = await this.prisma.job.findMany({
      where: {
        cineClubId,
        status: { in: [JobStatus.PENDING, JobStatus.AWAITING_NAS, JobStatus.AWAITING_SEEDBOX, JobStatus.IN_PROGRESS] },
      },
      orderBy: { createdAt: 'desc' },
    });
    return items.map(serialize);
  }

  parseRadarrPayload(payload: RadarrWebhookPayload, cineClubId: number) {
    const eventType = payload.eventType?.toLowerCase();
    if (eventType && !['download', 'import', 'movieadded', 'movieimported'].some((e) => eventType.includes(e))) {
      this.logger.log(`Radarr webhook ignoré (eventType=${eventType})`);
      return null;
    }
    const file = payload.movieFile;
    if (!file?.path) {
      this.logger.warn('Radarr webhook reçu sans movieFile.path — ignoré');
      return null;
    }
    return {
      cineClubId,
      source: JobSource.RADARR,
      sourcePath: file.path,
      fileName: file.relativePath ?? file.path.split('/').pop() ?? 'movie.mkv',
      fileSize: file.size ?? null,
      tmdbId: payload.movie?.tmdbId ?? payload.remoteMovie?.tmdbId ?? null,
      tmdbType: 'movie' as const,
    };
  }

  parseSonarrPayload(payload: SonarrWebhookPayload, cineClubId: number) {
    const eventType = payload.eventType?.toLowerCase();
    if (eventType && !['download', 'import', 'episodefileimported', 'importcomplete'].some((e) => eventType.includes(e))) {
      this.logger.log(`Sonarr webhook ignoré (eventType=${eventType})`);
      return null;
    }
    // Sonarr v3 = episodeFile (singular), v4 = episodeFiles (array)
    const file = payload.episodeFile ?? payload.episodeFiles?.[0];
    if (!file?.path) {
      this.logger.warn(`Sonarr webhook reçu sans episodeFile.path (eventType=${eventType}) — ignoré`);
      return null;
    }
    const firstEp = payload.episodes?.[0];
    return {
      cineClubId,
      source: JobSource.SONARR,
      sourcePath: file.path,
      fileName: file.relativePath ?? file.path.split('/').pop() ?? 'episode.mkv',
      fileSize: file.size ?? null,
      tmdbId: payload.series?.tmdbId ?? null,
      tmdbType: 'tv' as const,
      seasonNumber: firstEp?.seasonNumber ?? null,
      episodeNumber: firstEp?.episodeNumber ?? null,
    };
  }

  private async enqueueRun(jobId: number, delayMs?: number) {
    await this.queue.add(
      'run',
      { jobId },
      {
        ...(delayMs && delayMs > 0 ? { delay: delayMs } : {}),
        removeOnComplete: 100,
        removeOnFail: 500,
        attempts: 1,
      },
    );
  }

  // ── Bibliothèque Radarr/Sonarr (pour backfill manuel) ────────────────────

  async listRadarrLibrary(cineClubId: number): Promise<Array<{
    radarrId: number;
    title: string;
    year: number | null;
    tmdbId: number | null;
    hasFile: boolean;
    sourcePath: string | null;
    fileName: string | null;
    fileSize: number | null;
    quality: string | null;
    onNas: boolean;
    nasDeletedAt: string | null;
    activeJobId: number | null;
  }>> {
    const club = await this.prisma.cineClub.findUnique({ where: { id: cineClubId } });
    if (!club?.radarrBaseUrl || !club.radarrApiKey) {
      throw new BadRequestException('Radarr non configuré pour ce CineClub');
    }
    const apiKey = this.crypto.decrypt(club.radarrApiKey);
    const url = `${club.radarrBaseUrl.replace(/\/$/, '')}/api/v3/movie`;
    const res = await fetch(url, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadRequestException(`Radarr HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const movies = (await res.json()) as any[];

    // cross-check Media par tmdbId (NAS)
    const tmdbIds = movies.map((m) => m.tmdbId).filter((id): id is number => typeof id === 'number');
    const mediaByTmdb = new Map(
      (
        await this.prisma.media.findMany({
          where: { cineClubId, tmdbId: { in: tmdbIds } },
          select: { tmdbId: true, sourceType: true, nasDeletedAt: true },
        })
      ).map((m) => [m.tmdbId!, m]),
    );

    // jobs actifs (PENDING/AWAITING_*/IN_PROGRESS) DOWNLOAD_TO_NAS par tmdbId
    const activeJobs = await this.prisma.job.findMany({
      where: {
        cineClubId,
        kind: JobKind.DOWNLOAD_TO_NAS,
        tmdbId: { in: tmdbIds },
        status: { in: [JobStatus.PENDING, JobStatus.AWAITING_NAS, JobStatus.AWAITING_SEEDBOX, JobStatus.IN_PROGRESS] },
      },
      select: { id: true, tmdbId: true },
      orderBy: { createdAt: 'desc' },
    });
    const activeJobByTmdb = new Map(activeJobs.map((j) => [j.tmdbId!, j.id]));

    return movies.map((m) => {
      const onDb = m.tmdbId ? mediaByTmdb.get(m.tmdbId) : null;
      return {
        radarrId: m.id,
        title: m.title,
        year: m.year ?? null,
        tmdbId: m.tmdbId ?? null,
        hasFile: !!m.hasFile,
        sourcePath: m.movieFile?.path ?? null,
        fileName: m.movieFile?.relativePath ?? null,
        fileSize: m.movieFile?.size ?? null,
        quality: m.movieFile?.quality?.quality?.name ?? null,
        onNas: !!(onDb && onDb.sourceType === 'NAS' && !onDb.nasDeletedAt),
        nasDeletedAt: onDb?.nasDeletedAt?.toISOString() ?? null,
        activeJobId: m.tmdbId ? activeJobByTmdb.get(m.tmdbId) ?? null : null,
      };
    });
  }

  async listSonarrLibrary(cineClubId: number): Promise<Array<{
    sonarrSeriesId: number;
    sonarrEpisodeId: number;
    sonarrEpisodeFileId: number | null;
    seriesTitle: string;
    seriesTmdbId: number | null;
    seasonNumber: number;
    episodeNumber: number;
    episodeTitle: string | null;
    hasFile: boolean;
    sourcePath: string | null;
    fileName: string | null;
    fileSize: number | null;
    quality: string | null;
    onNas: boolean;
    activeJobId: number | null;
  }>> {
    const club = await this.prisma.cineClub.findUnique({ where: { id: cineClubId } });
    if (!club?.sonarrBaseUrl || !club.sonarrApiKey) {
      throw new BadRequestException('Sonarr non configuré pour ce CineClub');
    }
    const apiKey = this.crypto.decrypt(club.sonarrApiKey);
    const base = club.sonarrBaseUrl.replace(/\/$/, '');

    // 1. Séries
    const seriesRes = await fetch(`${base}/api/v3/series`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    if (!seriesRes.ok) {
      const body = await seriesRes.text().catch(() => '');
      throw new BadRequestException(`Sonarr HTTP ${seriesRes.status}: ${body.slice(0, 200)}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allSeries = (await seriesRes.json()) as any[];

    // 2. Episodes + files par série en parallèle.
    // /api/v3/episodefile EXIGE un seriesId (sans, Sonarr renvoie 400 → tableau vide → tous les sourcePath null → liste UI vide).
    const fetchHeaders = { 'X-Api-Key': apiKey };
    const seriesData = await Promise.all(
      allSeries.map(async (s) => {
        try {
          const [epsRes, filesRes] = await Promise.all([
            fetch(`${base}/api/v3/episode?seriesId=${s.id}`, { headers: fetchHeaders, signal: AbortSignal.timeout(30_000) }),
            fetch(`${base}/api/v3/episodefile?seriesId=${s.id}`, { headers: fetchHeaders, signal: AbortSignal.timeout(30_000) }),
          ]);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const eps = epsRes.ok ? ((await epsRes.json()) as any[]) : [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const files = filesRes.ok ? ((await filesRes.json()) as any[]) : [];
          return { series: s, episodes: eps, files };
        } catch (err) {
          this.logger.warn(`Sonarr fetch failed for series ${s.id}: ${err}`);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return { series: s, episodes: [] as any[], files: [] as any[] };
        }
      }),
    );

    const filesById = new Map<number, (typeof seriesData)[number]['files'][number]>();
    for (const { files } of seriesData) {
      for (const f of files) filesById.set(f.id, f);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allEpisodes: any[] = seriesData.flatMap(({ series, episodes }) =>
      episodes.map((ep) => ({ ...ep, _series: series })),
    );

    // cross-check NAS Episodes
    const seriesTmdbIds = allSeries.map((s) => s.tmdbId).filter((id): id is number => typeof id === 'number');
    const nasMediaByTmdb = new Map(
      (
        await this.prisma.media.findMany({
          where: { cineClubId, tmdbId: { in: seriesTmdbIds }, type: 'SERIES' },
          select: { id: true, tmdbId: true },
        })
      ).map((m) => [m.tmdbId!, m.id]),
    );
    const nasMediaIds = Array.from(nasMediaByTmdb.values());
    const nasEpisodes = await this.prisma.episode.findMany({
      where: {
        season: { mediaId: { in: nasMediaIds } },
        nasPath: { not: null },
        nasDeletedAt: null,
      },
      select: {
        episodeNumber: true,
        season: { select: { seasonNumber: true, mediaId: true } },
      },
    });
    const onNasKey = new Set(
      nasEpisodes.map((e) => `${e.season.mediaId}|${e.season.seasonNumber}|${e.episodeNumber}`),
    );

    const activeJobs = await this.prisma.job.findMany({
      where: {
        cineClubId,
        kind: JobKind.DOWNLOAD_TO_NAS,
        tmdbId: { in: seriesTmdbIds },
        seasonNumber: { not: null },
        episodeNumber: { not: null },
        status: { in: [JobStatus.PENDING, JobStatus.AWAITING_NAS, JobStatus.AWAITING_SEEDBOX, JobStatus.IN_PROGRESS] },
      },
      select: { id: true, tmdbId: true, seasonNumber: true, episodeNumber: true },
    });
    const activeJobKey = new Map(
      activeJobs.map((j) => [`${j.tmdbId}|${j.seasonNumber}|${j.episodeNumber}`, j.id]),
    );

    return allEpisodes.map((ep) => {
      const series = ep._series;
      const file = ep.episodeFileId ? filesById.get(ep.episodeFileId) : null;
      const mediaId = series.tmdbId ? nasMediaByTmdb.get(series.tmdbId) : undefined;
      const onNas = mediaId
        ? onNasKey.has(`${mediaId}|${ep.seasonNumber}|${ep.episodeNumber}`)
        : false;
      const activeKey = `${series.tmdbId}|${ep.seasonNumber}|${ep.episodeNumber}`;
      return {
        sonarrSeriesId: series.id,
        sonarrEpisodeId: ep.id,
        sonarrEpisodeFileId: ep.episodeFileId ?? null,
        seriesTitle: series.title,
        seriesTmdbId: series.tmdbId ?? null,
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.episodeNumber,
        episodeTitle: ep.title ?? null,
        hasFile: !!ep.hasFile,
        sourcePath: file?.path ?? null,
        fileName: file?.relativePath ?? null,
        fileSize: file?.size ?? null,
        quality: file?.quality?.quality?.name ?? null,
        onNas,
        activeJobId: activeJobKey.get(activeKey) ?? null,
      };
    });
  }
}

function serialize(job: JobRow) {
  return {
    ...job,
    fileSize: job.fileSize?.toString() ?? null,
  };
}
