import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Job as JobRow, JobKind, JobSource, JobStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { JOBS_QUEUE } from './jobs.constants';
import { RadarrWebhookPayload, SonarrWebhookPayload } from './dto/webhook-radarr.dto';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
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
    if (eventType && !['download', 'import', 'episodefileimported'].some((e) => eventType.includes(e))) {
      this.logger.log(`Sonarr webhook ignoré (eventType=${eventType})`);
      return null;
    }
    const file = payload.episodeFile;
    if (!file?.path) {
      this.logger.warn('Sonarr webhook reçu sans episodeFile.path — ignoré');
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
}

function serialize(job: JobRow) {
  return {
    ...job,
    fileSize: job.fileSize?.toString() ?? null,
  };
}
