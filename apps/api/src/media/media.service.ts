import { Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Media, MediaType, SyncStatus } from '@prisma/client';
import { JobsService } from '../jobs/jobs.service';
import { JobsGateway } from '../jobs/jobs.gateway';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => JobsService)) private readonly jobsService: JobsService,
    @Inject(forwardRef(() => JobsGateway)) private readonly jobsGateway: JobsGateway,
  ) {}

  private readonly includeRelations = {
    genres: { include: { genre: true } },
    cast: { include: { person: true }, orderBy: { order: 'asc' as const } },
  };

  // When the same movie/series exists in multiple files (e.g. NAS + Jellyfin or two qualities),
  // keep only the best version per tmdbId. Items without tmdbId are kept as-is.
  private deduplicateByTmdbId<T extends { tmdbId: number | null; videoQuality?: string | null; jellyfinItemId?: string | null; nasAddedAt?: Date | null; createdAt: Date }>(items: T[]): T[] {
    const QUALITY_RANK: Record<string, number> = { '4K': 3, '1080p': 2 };
    const seen = new Map<number, T>();

    for (const item of items) {
      if (item.tmdbId === null) continue;
      const existing = seen.get(item.tmdbId);
      if (!existing) { seen.set(item.tmdbId, item); continue; }

      const rankNew = QUALITY_RANK[item.videoQuality ?? ''] ?? 1;
      const rankExisting = QUALITY_RANK[existing.videoQuality ?? ''] ?? 1;

      if (rankNew > rankExisting) { seen.set(item.tmdbId, item); continue; }
      if (rankNew === rankExisting) {
        // Prefer Jellyfin source, then most recent
        const newIsJellyfin = !!item.jellyfinItemId;
        const existingIsJellyfin = !!existing.jellyfinItemId;
        if (newIsJellyfin && !existingIsJellyfin) { seen.set(item.tmdbId, item); continue; }
        if (newIsJellyfin === existingIsJellyfin) {
          const dateNew = item.nasAddedAt ?? item.createdAt;
          const dateExisting = existing.nasAddedAt ?? existing.createdAt;
          if (dateNew > dateExisting) seen.set(item.tmdbId, item);
        }
      }
    }

    return items.filter((item) => item.tmdbId === null || seen.get(item.tmdbId) === item);
  }

  async findAll(params: {
    cineClubId: number;
    type?: MediaType;
    genreId?: number;
    year?: number;
    page?: number;
    limit?: number;
  }) {
    const { cineClubId, type, genreId, year, page = 1, limit = 20 } = params;
    const where: Record<string, unknown> = { cineClubId };

    if (type) where.type = type;
    if (year) where.releaseYear = Number(year);
    if (genreId) where.genres = { some: { genreId: Number(genreId) } };
    // Only show synced items on public endpoints
    where.syncStatus = SyncStatus.SYNCED;

    const all = await this.prisma.media.findMany({
      where,
      include: this.includeRelations,
      orderBy: [{ nasAddedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });

    const deduplicated = this.deduplicateByTmdbId(all);
    const total = deduplicated.length;
    const data = deduplicated.slice((page - 1) * limit, page * limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findById(id: number, cineClubId: number) {
    const media = await this.prisma.media.findFirst({
      where: { id, cineClubId },
      include: {
        ...this.includeRelations,
        seasons: {
          include: { episodes: { orderBy: { episodeNumber: 'asc' } } },
          orderBy: { seasonNumber: 'asc' },
        },
      },
    });
    if (!media) throw new NotFoundException('Média introuvable');
    return media;
  }

  async search(query: string, cineClubId: number, page = 1, limit = 20) {
    const where = {
      cineClubId,
      OR: [
        { titleVf: { contains: query, mode: 'insensitive' as const } },
        { titleOriginal: { contains: query, mode: 'insensitive' as const } },
        { nasFilename: { contains: query, mode: 'insensitive' as const } },
      ],
    };

    const [data, total] = await Promise.all([
      this.prisma.media.findMany({
        where,
        include: this.includeRelations,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { titleVf: 'asc' },
      }),
      this.prisma.media.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findRecent(cineClubId: number, limit = 40) {
    const n = Number(limit);
    const rows = await this.prisma.media.findMany({
      where: { cineClubId, syncStatus: SyncStatus.SYNCED },
      include: this.includeRelations,
      orderBy: [{ nasAddedAt: 'desc' }, { createdAt: 'desc' }],
      take: n * 3,
    });
    return this.deduplicateByTmdbId(rows).slice(0, n);
  }

  async findByQuality(quality: 'UHD' | 'HDR' | 'FHD', cineClubId: number, limit = 20) {
    const where: Record<string, unknown> = { cineClubId, syncStatus: SyncStatus.SYNCED };
    if (quality === 'UHD') where.videoQuality = '4K';
    else if (quality === 'HDR') where.OR = [{ hdr: true }, { dolbyVision: true }];
    else if (quality === 'FHD') where.videoQuality = '1080p';

    const n = Number(limit);
    const rows = await this.prisma.media.findMany({
      where,
      include: this.includeRelations,
      orderBy: [{ nasAddedAt: 'desc' }, { createdAt: 'desc' }],
      take: n * 3,
    });
    return this.deduplicateByTmdbId(rows).slice(0, n);
  }

  async findAllAdmin(params: {
    cineClubId: number;
    type?: MediaType;
    status?: SyncStatus;
    title?: string;
    videoQuality?: string;
    dolbyVision?: boolean;
    hdr?: boolean;
    dolbyAtmos?: boolean;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    page?: number;
    limit?: number;
  }) {
    const { cineClubId, type, status, title, videoQuality, dolbyVision, hdr, dolbyAtmos, sortBy = 'nasAddedAt', sortOrder = 'desc', page = 1, limit = 20 } = params;
    const where: Record<string, unknown> = { cineClubId };
    if (type) where.type = type;
    if (status) where.syncStatus = status;
    if (title) {
      where.OR = [
        { titleVf: { contains: title, mode: 'insensitive' } },
        { titleOriginal: { contains: title, mode: 'insensitive' } },
        { nasFilename: { contains: title, mode: 'insensitive' } },
      ];
    }
    if (videoQuality) where.videoQuality = videoQuality;
    if (dolbyVision) where.dolbyVision = true;
    if (hdr) where.hdr = true;
    if (dolbyAtmos) where.dolbyAtmos = true;

    const sortField = sortBy === 'title' ? 'titleVf' : sortBy;
    // nasAddedAt can be null; fall back to createdAt for nulls
    const orderBy = sortField === 'nasAddedAt'
      ? [{ nasAddedAt: { sort: sortOrder, nulls: 'last' as const } }, { createdAt: sortOrder }]
      : [{ [sortField]: sortOrder }];

    const [data, total] = await Promise.all([
      this.prisma.media.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy }),
      this.prisma.media.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findUnsynchronized(cineClubId: number, page = 1, limit = 20) {
    const where = {
      cineClubId,
      syncStatus: { in: [SyncStatus.PENDING, SyncStatus.FAILED, SyncStatus.NOT_FOUND] },
    };

    const [data, total] = await Promise.all([
      this.prisma.media.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.media.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async delete(id: number, cineClubId: number, triggeredBy?: string | null) {
    const media = await this.prisma.media.findFirst({
      where: { id, cineClubId },
      include: {
        seasons: { include: { episodes: true } },
      },
    });
    if (!media) throw new NotFoundException('Média introuvable');

    const club = await this.prisma.cineClub.findUnique({ where: { id: cineClubId } });
    const jobsEnqueued: Array<{ kind: string; jobId: number }> = [];

    const safeEnqueue = async (kind: string, fn: () => Promise<{ id: number }>) => {
      try {
        const job = await fn();
        this.jobsGateway.emitJobCreated(cineClubId, job as never);
        jobsEnqueued.push({ kind, jobId: job.id });
      } catch (err) {
        this.logger.warn(`Enqueue ${kind} échoué pour Media ${id}: ${err}`);
      }
    };

    // 1. Fichiers NAS
    if (media.type === MediaType.MOVIE) {
      if (media.nasPath) {
        await safeEnqueue('DELETE_FROM_NAS', () =>
          this.jobsService.createNasDeletionJob({
            cineClubId,
            sourcePath: media.nasPath,
            fileName: media.nasFilename,
            mediaId: media.id,
            triggeredBy,
          }),
        );
      }
    } else {
      for (const season of media.seasons) {
        for (const ep of season.episodes) {
          if (ep.nasPath) {
            await safeEnqueue('DELETE_FROM_NAS', () =>
              this.jobsService.createNasDeletionJob({
                cineClubId,
                sourcePath: ep.nasPath!,
                fileName: ep.nasFilename,
                mediaId: media.id,
                episodeId: ep.id,
                triggeredBy,
              }),
            );
          }
        }
      }
    }

    // 2. Jellyfin (item au niveau média + chaque épisode qui a son propre item)
    if (media.jellyfinItemId) {
      await safeEnqueue('DELETE_FROM_JELLYFIN', () =>
        this.jobsService.createJellyfinDeletionJob({
          cineClubId,
          mediaId: media.id,
          jellyfinItemId: media.jellyfinItemId!,
          triggeredBy,
        }),
      );
    }
    for (const season of media.seasons) {
      for (const ep of season.episodes) {
        if (ep.jellyfinItemId) {
          await safeEnqueue('DELETE_FROM_JELLYFIN', () =>
            this.jobsService.createJellyfinDeletionJob({
              cineClubId,
              mediaId: media.id,
              episodeId: ep.id,
              jellyfinItemId: ep.jellyfinItemId!,
              triggeredBy,
            }),
          );
        }
      }
    }

    // 3. Radarr / Sonarr
    if (media.tmdbId && club) {
      if (media.type === MediaType.MOVIE && club.radarrBaseUrl && club.radarrApiKey) {
        await safeEnqueue('DELETE_FROM_RADARR', () =>
          this.jobsService.createRadarrDeletionJob({
            cineClubId,
            mediaId: media.id,
            tmdbId: media.tmdbId!,
            triggeredBy,
          }),
        );
      } else if (media.type === MediaType.SERIES && club.sonarrBaseUrl && club.sonarrApiKey) {
        await safeEnqueue('DELETE_FROM_SONARR', () =>
          this.jobsService.createSonarrDeletionJob({
            cineClubId,
            mediaId: media.id,
            tmdbId: media.tmdbId!,
            triggeredBy,
          }),
        );
      }
    }

    // 4. Suppression DB (cascade Prisma sur Season/Episode/MediaGenre/MediaPerson)
    await this.prisma.media.delete({ where: { id } });

    return { deleted: true, jobsEnqueued };
  }

  async deleteEpisode(mediaId: number, episodeId: number, cineClubId: number, triggeredBy?: string | null) {
    const media = await this.prisma.media.findFirst({ where: { id: mediaId, cineClubId } });
    if (!media) throw new NotFoundException('Média introuvable');

    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, season: { mediaId } },
      include: { season: true },
    });
    if (!episode) throw new NotFoundException('Épisode introuvable');

    const club = await this.prisma.cineClub.findUnique({ where: { id: cineClubId } });
    const jobsEnqueued: Array<{ kind: string; jobId: number }> = [];

    const safeEnqueue = async (kind: string, fn: () => Promise<{ id: number }>) => {
      try {
        const job = await fn();
        this.jobsGateway.emitJobCreated(cineClubId, job as never);
        jobsEnqueued.push({ kind, jobId: job.id });
      } catch (err) {
        this.logger.warn(`Enqueue ${kind} échoué pour Episode ${episodeId}: ${err}`);
      }
    };

    if (episode.nasPath) {
      await safeEnqueue('DELETE_FROM_NAS', () =>
        this.jobsService.createNasDeletionJob({
          cineClubId,
          sourcePath: episode.nasPath!,
          fileName: episode.nasFilename,
          mediaId,
          episodeId,
          triggeredBy,
        }),
      );
    }
    if (episode.jellyfinItemId) {
      await safeEnqueue('DELETE_FROM_JELLYFIN', () =>
        this.jobsService.createJellyfinDeletionJob({
          cineClubId,
          mediaId,
          episodeId,
          jellyfinItemId: episode.jellyfinItemId!,
          triggeredBy,
        }),
      );
    }
    if (media.tmdbId && club?.sonarrBaseUrl && club?.sonarrApiKey) {
      await safeEnqueue('DELETE_FROM_SONARR', () =>
        this.jobsService.createSonarrDeletionJob({
          cineClubId,
          mediaId,
          tmdbId: media.tmdbId!,
          episodeId,
          sourcePath: episode.nasPath ?? null,
          seasonNumber: episode.season.seasonNumber,
          episodeNumber: episode.episodeNumber,
          triggeredBy,
        }),
      );
    }

    await this.prisma.episode.delete({ where: { id: episodeId } });

    return { deleted: true, jobsEnqueued };
  }

  async update(id: number, cineClubId: number, data: Partial<{ titleVf: string; titleOriginal: string; overview: string; tmdbId: number | null; releaseYear: number; syncStatus: SyncStatus; syncError: string | null; type: MediaType }>) {
    await this.findById(id, cineClubId);
    const patch: typeof data = { ...data };

    // Resync strategy: the sync engine tries tmdbId first and falls back to title+year on failure.
    // If the admin explicitly sets a tmdbId (even the same), keep it so sync uses it.
    // If no tmdbId is provided, clear it to force a fresh title+year search.
    if (data.syncStatus === SyncStatus.PENDING) {
      if (data.tmdbId !== undefined && data.tmdbId !== null) {
        patch.tmdbId = data.tmdbId;
      } else {
        patch.tmdbId = null;
        patch.titleVf = undefined;
      }
    }
    return this.prisma.media.update({ where: { id }, data: patch });
  }

  async getGenres(cineClubId: number) {
    // Return genres that have at least one media item in this cineclub
    return this.prisma.genre.findMany({
      where: {
        media: {
          some: {
            media: { cineClubId },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  // Cherche l'ID Jellyfin correspondant au TMDB ID et l'écrit sur le Media.
  // Appelé à la complétion d'un transfert. Pas d'effet si Jellyfin pas configuré
  // ou si le média n'a pas de tmdbId.
  async populateJellyfinId(media: Media, type: 'movie' | 'tv'): Promise<string | null> {
    if (!media.tmdbId) return null;
    const club = await this.prisma.cineClub.findUnique({ where: { id: media.cineClubId } });
    if (!club?.jellyfinBaseUrl || !club.jellyfinApiToken) return null;

    const itemType = type === 'tv' ? 'Series' : 'Movie';
    const base = club.jellyfinBaseUrl.replace(/\/$/, '');
    const url = new URL(`${base}/Items`);
    url.searchParams.set('Recursive', 'true');
    url.searchParams.set('IncludeItemTypes', itemType);
    url.searchParams.set('AnyProviderIdEquals', `tmdb.${media.tmdbId}`);
    url.searchParams.set('Limit', '1');
    url.searchParams.set('Fields', 'ProviderIds');

    let itemId: string | null = null;
    try {
      const res = await fetch(url.toString(), {
        headers: { 'X-Emby-Token': club.jellyfinApiToken },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.logger.warn(`Jellyfin /Items HTTP ${res.status} pour tmdbId=${media.tmdbId}`);
        return null;
      }
      const data = (await res.json()) as { Items?: Array<{ Id?: string; ProviderIds?: Record<string, string> }> };
      const found = data.Items?.find((item) => {
        const tmdbProv = item.ProviderIds?.Tmdb ?? item.ProviderIds?.tmdb;
        return tmdbProv && parseInt(tmdbProv, 10) === media.tmdbId;
      });
      itemId = found?.Id ?? null;
    } catch (err) {
      this.logger.warn(`populateJellyfinId fetch error: ${err}`);
      return null;
    }

    if (itemId && itemId !== media.jellyfinItemId) {
      await this.prisma.media.update({
        where: { id: media.id },
        data: { jellyfinItemId: itemId },
      });
      this.logger.log(`Media ${media.id} → jellyfinItemId=${itemId}`);
    }
    return itemId;
  }
}
