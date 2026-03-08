import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { NasService } from '../nas/nas.service';
import { MetadataService } from '../metadata/metadata.service';
import { MediaType, SyncStatus } from '@prisma/client';
import * as ptt from 'parse-torrent-title';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private isSyncing = false;

  constructor(
    private prisma: PrismaService,
    private nasService: NasService,
    private metadataService: MetadataService,
  ) {}

  async fullSync(triggeredBy = 'manual') {
    if (this.isSyncing) {
      this.logger.warn('Sync already in progress, skipping');
      return { message: 'Sync already in progress' };
    }

    this.isSyncing = true;
    const syncLog = await this.prisma.syncLog.create({
      data: { type: 'full_scan', status: 'running', triggeredBy },
    });

    try {
      // Step 1: Get all video files from NAS
      await this.nasService.login();
      const nasFiles = await this.nasService.listAllVideoFiles();
      this.logger.log(`Found ${nasFiles.length} video files on NAS`);

      // Step 2: Reconcile - remove DB entries for files no longer on NAS
      const existingMedia = await this.prisma.media.findMany({ select: { id: true, nasPath: true } });
      const nasPaths = new Set(nasFiles.map((f) => f.path));
      const orphaned = existingMedia.filter((m) => !nasPaths.has(m.nasPath));

      if (orphaned.length > 0) {
        this.logger.log(`Removing ${orphaned.length} orphaned entries from DB`);
        await this.prisma.media.deleteMany({
          where: { id: { in: orphaned.map((o) => o.id) } },
        });
      }

      // Step 3: Add new files to DB
      let processedItems = 0;
      let errorCount = 0;
      const errors: string[] = [];

      for (const file of nasFiles) {
        try {
          const existing = await this.prisma.media.findUnique({ where: { nasPath: file.path } });
          if (existing) {
            processedItems++;
            continue;
          }

          // Parse filename
          const parsed = ptt.parse(file.name);

          await this.prisma.media.create({
            data: {
              type: parsed.season !== undefined ? MediaType.SERIES : MediaType.MOVIE,
              titleOriginal: parsed.title || file.name,
              nasPath: file.path,
              nasFilename: file.name,
              nasSize: file.additional?.size ? BigInt(file.additional.size) : null,
              syncStatus: SyncStatus.PENDING,
            },
          });

          processedItems++;
        } catch (error: any) {
          errorCount++;
          errors.push(`${file.name}: ${error.message}`);
          this.logger.error(`Error processing ${file.name}: ${error.message}`);
        }
      }

      // Step 4: Sync metadata for PENDING items
      await this.syncPendingMetadata();

      await this.nasService.logout();

      // Update sync log
      await this.prisma.syncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'completed',
          totalItems: nasFiles.length,
          processedItems,
          errorCount,
          errorDetails: errors.length > 0 ? JSON.stringify(errors) : null,
          completedAt: new Date(),
        },
      });

      // Update NAS config last sync
      await this.prisma.nasConfig.updateMany({
        where: { isActive: true },
        data: { lastSyncAt: new Date() },
      });

      return {
        message: 'Sync completed',
        totalFiles: nasFiles.length,
        processed: processedItems,
        orphanedRemoved: orphaned.length,
        errors: errorCount,
      };
    } catch (error: any) {
      await this.prisma.syncLog.update({
        where: { id: syncLog.id },
        data: { status: 'failed', errorDetails: error.message, completedAt: new Date() },
      });
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  async syncPendingMetadata() {
    const pending = await this.prisma.media.findMany({
      where: { syncStatus: SyncStatus.PENDING },
      take: 50, // Process in batches
    });

    this.logger.log(`Syncing metadata for ${pending.length} pending items`);

    for (const media of pending) {
      try {
        await this.syncSingleMedia(media.id);
        // Small delay to respect TMDB rate limits
        await new Promise((resolve) => setTimeout(resolve, 250));
      } catch (error: any) {
        this.logger.error(`Metadata sync failed for ${media.titleOriginal}: ${error.message}`);
      }
    }
  }

  async syncSingleMedia(mediaId: number) {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) throw new Error('Media not found');

    await this.prisma.media.update({
      where: { id: mediaId },
      data: { syncStatus: SyncStatus.SYNCING },
    });

    try {
      const parsed = ptt.parse(media.nasFilename);
      const title = parsed.title || media.titleOriginal;
      const year = parsed.year;
      const isSeries = parsed.season !== undefined;

      let tmdbResult: any = null;
      let mediaType: MediaType;

      if (isSeries) {
        // Search TV first for series
        const tvResults = await this.metadataService.searchTv(title, year);
        if (tvResults.length > 0) {
          tmdbResult = tvResults[0];
          mediaType = MediaType.SERIES;
        } else {
          const movieResults = await this.metadataService.searchMovie(title, year);
          tmdbResult = movieResults[0] || null;
          mediaType = MediaType.MOVIE;
        }
      } else {
        // Search movie first for films
        const movieResults = await this.metadataService.searchMovie(title, year);
        if (movieResults.length > 0) {
          tmdbResult = movieResults[0];
          mediaType = MediaType.MOVIE;
        } else {
          const tvResults = await this.metadataService.searchTv(title, year);
          tmdbResult = tvResults[0] || null;
          mediaType = MediaType.SERIES;
        }
      }

      if (!tmdbResult) {
        await this.prisma.media.update({
          where: { id: mediaId },
          data: { syncStatus: SyncStatus.NOT_FOUND, syncError: 'No TMDB match found' },
        });
        return;
      }

      // Fetch full details
      if (mediaType === MediaType.MOVIE) {
        await this.syncMovieDetails(mediaId, tmdbResult.id);
      } else {
        await this.syncTvDetails(mediaId, tmdbResult.id);
      }
    } catch (error: any) {
      await this.prisma.media.update({
        where: { id: mediaId },
        data: { syncStatus: SyncStatus.FAILED, syncError: error.message },
      });
      throw error;
    }
  }

  private async syncMovieDetails(mediaId: number, tmdbId: number) {
    const detail = await this.metadataService.getMovieDetail(tmdbId);

    // Upsert genres
    const genreIds: number[] = [];
    for (const g of detail.genres) {
      const genre = await this.prisma.genre.upsert({
        where: { tmdbId: g.id },
        update: { name: g.name },
        create: { tmdbId: g.id, name: g.name },
      });
      genreIds.push(genre.id);
    }

    // Upsert persons (cast + director)
    const persons: { personId: number; role: string; character?: string; order: number }[] = [];
    const cast = detail.credits?.cast?.slice(0, 10) || [];
    for (const c of cast) {
      const person = await this.prisma.person.upsert({
        where: { tmdbId: c.id },
        update: { name: c.name, photoUrl: this.metadataService.profileUrl(c.profile_path) },
        create: { tmdbId: c.id, name: c.name, photoUrl: this.metadataService.profileUrl(c.profile_path) },
      });
      persons.push({ personId: person.id, role: 'actor', character: c.character, order: c.order });
    }

    const directors = detail.credits?.crew?.filter((c) => c.job === 'Director') || [];
    for (const d of directors) {
      const person = await this.prisma.person.upsert({
        where: { tmdbId: d.id },
        update: { name: d.name, photoUrl: this.metadataService.profileUrl(d.profile_path) },
        create: { tmdbId: d.id, name: d.name, photoUrl: this.metadataService.profileUrl(d.profile_path) },
      });
      persons.push({ personId: person.id, role: 'director', order: 0 });
    }

    // Update media
    await this.prisma.media.update({
      where: { id: mediaId },
      data: {
        type: MediaType.MOVIE,
        titleVf: detail.title,
        titleOriginal: detail.original_title,
        tmdbId: detail.id,
        overview: detail.overview,
        posterUrl: this.metadataService.posterUrl(detail.poster_path),
        backdropUrl: this.metadataService.backdropUrl(detail.backdrop_path),
        trailerUrl: this.metadataService.extractTrailerUrl(detail.videos),
        releaseDate: detail.release_date ? new Date(detail.release_date) : null,
        releaseYear: detail.release_date ? parseInt(detail.release_date.slice(0, 4)) : null,
        runtime: detail.runtime,
        voteAverage: detail.vote_average,
        syncStatus: SyncStatus.SYNCED,
        lastSyncedAt: new Date(),
        syncError: null,
      },
    });

    // Link genres
    await this.prisma.mediaGenre.deleteMany({ where: { mediaId } });
    for (const genreId of genreIds) {
      await this.prisma.mediaGenre.create({ data: { mediaId, genreId } });
    }

    // Link persons
    await this.prisma.mediaPerson.deleteMany({ where: { mediaId } });
    for (const p of persons) {
      await this.prisma.mediaPerson.create({
        data: { mediaId, ...p },
      });
    }
  }

  private async syncTvDetails(mediaId: number, tmdbId: number) {
    const detail = await this.metadataService.getTvDetail(tmdbId);

    // Upsert genres
    const genreIds: number[] = [];
    for (const g of detail.genres) {
      const genre = await this.prisma.genre.upsert({
        where: { tmdbId: g.id },
        update: { name: g.name },
        create: { tmdbId: g.id, name: g.name },
      });
      genreIds.push(genre.id);
    }

    // Upsert persons
    const persons: { personId: number; role: string; character?: string; order: number }[] = [];
    const cast = detail.credits?.cast?.slice(0, 10) || [];
    for (const c of cast) {
      const person = await this.prisma.person.upsert({
        where: { tmdbId: c.id },
        update: { name: c.name, photoUrl: this.metadataService.profileUrl(c.profile_path) },
        create: { tmdbId: c.id, name: c.name, photoUrl: this.metadataService.profileUrl(c.profile_path) },
      });
      persons.push({ personId: person.id, role: 'actor', character: c.character, order: c.order });
    }

    // Update media
    await this.prisma.media.update({
      where: { id: mediaId },
      data: {
        type: MediaType.SERIES,
        titleVf: detail.name,
        titleOriginal: detail.original_name,
        tmdbId: detail.id,
        overview: detail.overview,
        posterUrl: this.metadataService.posterUrl(detail.poster_path),
        backdropUrl: this.metadataService.backdropUrl(detail.backdrop_path),
        trailerUrl: this.metadataService.extractTrailerUrl(detail.videos),
        releaseDate: detail.first_air_date ? new Date(detail.first_air_date) : null,
        releaseYear: detail.first_air_date ? parseInt(detail.first_air_date.slice(0, 4)) : null,
        runtime: detail.episode_run_time?.[0] || null,
        voteAverage: detail.vote_average,
        syncStatus: SyncStatus.SYNCED,
        lastSyncedAt: new Date(),
        syncError: null,
      },
    });

    // Link genres
    await this.prisma.mediaGenre.deleteMany({ where: { mediaId } });
    for (const genreId of genreIds) {
      await this.prisma.mediaGenre.create({ data: { mediaId, genreId } });
    }

    // Link persons
    await this.prisma.mediaPerson.deleteMany({ where: { mediaId } });
    for (const p of persons) {
      await this.prisma.mediaPerson.create({
        data: { mediaId, ...p },
      });
    }

    // Upsert seasons
    for (const s of detail.seasons) {
      if (s.season_number === 0) continue; // Skip specials
      await this.prisma.season.upsert({
        where: { mediaId_seasonNumber: { mediaId, seasonNumber: s.season_number } },
        update: {
          name: s.name,
          overview: s.overview,
          posterUrl: this.metadataService.posterUrl(s.poster_path),
          episodeCount: s.episode_count,
          airDate: s.air_date ? new Date(s.air_date) : null,
        },
        create: {
          mediaId,
          seasonNumber: s.season_number,
          name: s.name,
          overview: s.overview,
          posterUrl: this.metadataService.posterUrl(s.poster_path),
          episodeCount: s.episode_count,
          airDate: s.air_date ? new Date(s.air_date) : null,
        },
      });
    }
  }

  async getSyncLogs(page = 1, limit = 20) {
    const [data, total] = await Promise.all([
      this.prisma.syncLog.findMany({
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.syncLog.count(),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
