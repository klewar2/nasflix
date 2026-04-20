import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { MediaType, SyncStatus } from '@prisma/client';

@Injectable()
export class MediaService {
  constructor(private readonly prisma: PrismaService) {}

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

  async delete(id: number, cineClubId: number) {
    await this.findById(id, cineClubId);
    return this.prisma.media.delete({ where: { id } });
  }

  async update(id: number, cineClubId: number, data: Partial<{ titleVf: string; titleOriginal: string; overview: string; tmdbId: number | null; releaseYear: number; syncStatus: SyncStatus; syncError: string | null }>) {
    await this.findById(id, cineClubId);
    // When re-queuing for sync without an explicit tmdbId, clear stale TMDB data so the
    // next sync searches from scratch instead of reusing a potentially wrong tmdbId.
    const patch: typeof data = { ...data };
    if (data.syncStatus === SyncStatus.PENDING && data.tmdbId === undefined) {
      patch.tmdbId = null;
      patch.titleVf = undefined; // keep existing until new sync fills it
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
}
