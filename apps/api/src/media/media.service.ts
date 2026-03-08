import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { MediaType, SyncStatus } from '@prisma/client';

@Injectable()
export class MediaService {
  constructor(private prisma: PrismaService) {}

  private readonly includeRelations = {
    genres: { include: { genre: true } },
    cast: { include: { person: true }, orderBy: { order: 'asc' as const } },
  };

  async findAll(params: {
    type?: MediaType;
    genreId?: number;
    year?: number;
    page?: number;
    limit?: number;
  }) {
    const { type, genreId, year, page = 1, limit = 20 } = params;
    const where: any = {};

    if (type) where.type = type;
    if (year) where.releaseYear = year;
    if (genreId) where.genres = { some: { genreId } };
    // Only show synced items on public endpoints
    where.syncStatus = SyncStatus.SYNCED;

    const [data, total] = await Promise.all([
      this.prisma.media.findMany({
        where,
        include: this.includeRelations,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.media.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findById(id: number) {
    return this.prisma.media.findUnique({
      where: { id },
      include: {
        ...this.includeRelations,
        seasons: {
          include: { episodes: { orderBy: { episodeNumber: 'asc' } } },
          orderBy: { seasonNumber: 'asc' },
        },
      },
    });
  }

  async search(query: string, page = 1, limit = 20) {
    const where = {
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

  async findRecent(limit = 20) {
    return this.prisma.media.findMany({
      where: { syncStatus: SyncStatus.SYNCED },
      include: this.includeRelations,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async findUnsynchronized(page = 1, limit = 20) {
    const where = {
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

  async findByGenre(genreId: number, type?: MediaType, limit = 20) {
    return this.prisma.media.findMany({
      where: {
        syncStatus: SyncStatus.SYNCED,
        genres: { some: { genreId } },
        ...(type ? { type } : {}),
      },
      include: this.includeRelations,
      orderBy: { voteAverage: 'desc' },
      take: limit,
    });
  }

  async delete(id: number) {
    return this.prisma.media.delete({ where: { id } });
  }

  async update(id: number, data: Partial<{ titleVf: string; overview: string; tmdbId: number }>) {
    return this.prisma.media.update({ where: { id }, data });
  }

  async getGenres() {
    return this.prisma.genre.findMany({
      orderBy: { name: 'asc' },
    });
  }
}
