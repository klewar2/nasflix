import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../common/prisma.service';
import { NasService } from '../nas/nas.service';
import { MetadataService, TmdbSearchResult } from '../metadata/metadata.service';
import { MediaType, SyncStatus } from '@prisma/client';
import { parseMediaFilename, ParsedMediaInfo } from '../common/media-parser';
import { METADATA_SYNC_QUEUE } from './sync.constants';
import { SyncGateway } from './sync.gateway';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private isSyncing = false;

  constructor(
    private prisma: PrismaService,
    private nasService: NasService,
    private metadataService: MetadataService,
    @InjectQueue(METADATA_SYNC_QUEUE) private metadataQueue: Queue,
    @Inject(forwardRef(() => SyncGateway)) private syncGateway: SyncGateway,
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

      // Step 2: Reconcile Media records
      const existingMedia = await this.prisma.media.findMany({ select: { id: true, nasPath: true } });
      const nasPaths = new Set(nasFiles.map((f) => f.path));
      const orphaned = existingMedia.filter((m) => !nasPaths.has(m.nasPath));

      if (orphaned.length > 0) {
        this.logger.log(`Removing ${orphaned.length} orphaned Media entries`);
        await this.prisma.media.deleteMany({ where: { id: { in: orphaned.map((o) => o.id) } } });
      }

      // Step 2b: Reconcile Episode nasPath (episode files removed from NAS)
      const existingEpisodes = await this.prisma.episode.findMany({
        where: { nasPath: { not: null } },
        select: { id: true, nasPath: true },
      });
      const orphanedEpisodes = existingEpisodes.filter((e) => e.nasPath && !nasPaths.has(e.nasPath));
      if (orphanedEpisodes.length > 0) {
        this.logger.log(`Clearing nasPath for ${orphanedEpisodes.length} orphaned episode(s)`);
        await this.prisma.episode.updateMany({
          where: { id: { in: orphanedEpisodes.map((e) => e.id) } },
          data: { nasPath: null, nasFilename: null, nasSize: null },
        });
      }

      // Step 3: Add new files to DB with parsed quality info
      let processedItems = 0;
      let errorCount = 0;
      const errors: string[] = [];

      for (const file of nasFiles) {
        try {
          // Skip files already tracked as episode nasPath
          const episodeExists = await this.prisma.episode.findUnique({ where: { nasPath: file.path } });
          if (episodeExists) { processedItems++; continue; }

          const existing = await this.prisma.media.findUnique({ where: { nasPath: file.path } });
          if (existing) {
            // Update nasAddedAt from NAS mtime/crtime if not yet set
            const existingMtime = Number(file.additional?.time?.mtime) || Number(file.additional?.time?.crtime) || 0;
            if (!existing.nasAddedAt && existingMtime > 0) {
              await this.prisma.media.update({
                where: { id: existing.id },
                data: { nasAddedAt: new Date(existingMtime * 1000) },
              });
            }
            processedItems++;
            continue;
          }

          const parsed = parseMediaFilename(file.name);
          const rawMtime = file.additional?.time?.mtime;
          const rawCrtime = file.additional?.time?.crtime;
          const timestamp = Number(rawMtime) || Number(rawCrtime) || 0;
          const nasAddedAt = timestamp > 0 ? new Date(timestamp * 1000) : null;

          // Also parse parent folder name to fill missing quality info
          const pathParts = file.path.split('/').filter(Boolean);
          if (pathParts.length >= 2 && (!parsed.videoQuality || (!parsed.hdr && !parsed.dolbyVision && !parsed.dolbyAtmos && !parsed.audioFormat))) {
            const folderParsed = parseMediaFilename(pathParts[pathParts.length - 2] + '.mkv');
            if (!parsed.videoQuality) parsed.videoQuality = folderParsed.videoQuality;
            if (!parsed.hdr) parsed.hdr = folderParsed.hdr;
            if (!parsed.dolbyVision) parsed.dolbyVision = folderParsed.dolbyVision;
            if (!parsed.dolbyAtmos) parsed.dolbyAtmos = folderParsed.dolbyAtmos;
            if (!parsed.audioFormat) parsed.audioFormat = folderParsed.audioFormat;
          }

          await this.prisma.media.create({
            data: {
              type: parsed.season !== undefined ? MediaType.SERIES : MediaType.MOVIE,
              titleOriginal: parsed.title || file.name,
              nasPath: file.path,
              nasFilename: file.name,
              nasSize: file.additional?.size ? BigInt(String(file.additional.size)) : null,
              nasAddedAt,
              videoQuality: parsed.videoQuality ?? null,
              hdr: parsed.hdr,
              dolbyVision: parsed.dolbyVision,
              dolbyAtmos: parsed.dolbyAtmos,
              audioFormat: parsed.audioFormat ?? null,
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

      // Step 4: Enqueue metadata sync for PENDING items
      const queued = await this.enqueuePendingMetadata();
      this.logger.log(`Enqueued ${queued} metadata sync jobs`);

      await this.nasService.logout();

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

      await this.prisma.nasConfig.updateMany({
        where: { isActive: true },
        data: { lastSyncAt: new Date() },
      });

      return {
        message: 'Sync completed, metadata jobs enqueued',
        totalFiles: nasFiles.length,
        processed: processedItems,
        orphanedRemoved: orphaned.length,
        errors: errorCount,
        metadataQueued: queued,
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

  async diffSync(changes: { added?: string[]; removed?: string[]; moved?: Array<{ from: string; to: string }> }) {
    const { added = [], removed = [], moved = [] } = changes;
    this.logger.log(`DiffSync: +${added.length} added, -${removed.length} removed, ~${moved.length} moved`);

    // Suppressions
    if (removed.length > 0) {
      await this.prisma.media.deleteMany({ where: { nasPath: { in: removed } } });
      await this.prisma.episode.updateMany({
        where: { nasPath: { in: removed } },
        data: { nasPath: null, nasFilename: null, nasSize: null },
      });
      this.logger.log(`Removed ${removed.length} file(s) from DB`);
    }

    // Déplacements / renommages
    for (const { from, to } of moved) {
      const filename = to.split('/').pop() || '';
      await this.prisma.media.updateMany({ where: { nasPath: from }, data: { nasPath: to, nasFilename: filename } });
      await this.prisma.episode.updateMany({ where: { nasPath: from }, data: { nasPath: to, nasFilename: filename } });
    }
    if (moved.length > 0) {
      this.logger.log(`Updated ${moved.length} moved file(s) in DB`);
    }

    // Ajouts
    for (const filePath of added) {
      const filename = filePath.split('/').pop() || '';

      const episodeExists = await this.prisma.episode.findUnique({ where: { nasPath: filePath } });
      if (episodeExists) continue;
      const existing = await this.prisma.media.findUnique({ where: { nasPath: filePath } });
      if (existing) continue;

      const parsed = parseMediaFilename(filename);
      const pathParts = filePath.split('/').filter(Boolean);
      if (pathParts.length >= 2 && (!parsed.videoQuality || (!parsed.hdr && !parsed.dolbyVision && !parsed.dolbyAtmos && !parsed.audioFormat))) {
        const folderParsed = parseMediaFilename(pathParts[pathParts.length - 2] + '.mkv');
        if (!parsed.videoQuality) parsed.videoQuality = folderParsed.videoQuality;
        if (!parsed.hdr) parsed.hdr = folderParsed.hdr;
        if (!parsed.dolbyVision) parsed.dolbyVision = folderParsed.dolbyVision;
        if (!parsed.dolbyAtmos) parsed.dolbyAtmos = folderParsed.dolbyAtmos;
        if (!parsed.audioFormat) parsed.audioFormat = folderParsed.audioFormat;
      }

      await this.prisma.media.create({
        data: {
          type: parsed.season !== undefined ? MediaType.SERIES : MediaType.MOVIE,
          titleOriginal: parsed.title || filename,
          nasPath: filePath,
          nasFilename: filename,
          nasSize: null,
          nasAddedAt: new Date(),
          videoQuality: parsed.videoQuality ?? null,
          hdr: parsed.hdr,
          dolbyVision: parsed.dolbyVision,
          dolbyAtmos: parsed.dolbyAtmos,
          audioFormat: parsed.audioFormat ?? null,
          syncStatus: SyncStatus.PENDING,
        },
      });
    }

    if (added.length > 0) {
      const queued = await this.enqueuePendingMetadata();
      this.logger.log(`Added ${added.length} file(s), enqueued ${queued} metadata job(s)`);
    }
  }

  /**
   * Picks the best TMDB result by scoring title similarity, year match, and popularity.
   * Avoids blindly taking results[0] which can return completely wrong matches.
   */
  private pickBestResult(
    results: TmdbSearchResult[],
    searchTitle: string,
    searchYear?: number,
  ): TmdbSearchResult | null {
    if (results.length === 0) return null;
    if (results.length === 1) return results[0];

    const normalize = (s: string) =>
      s.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9 ]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const needle = normalize(searchTitle);

    const scored = results.map((r) => {
      const rt = normalize(r.title || r.name || '');
      let score = 0;

      // Title similarity (most important criterion)
      if (rt === needle) score += 100;
      else if (rt.startsWith(needle + ' ') || rt.endsWith(' ' + needle)) score += 60;
      else if (needle.length >= 3 && rt.includes(needle)) score += 30;

      // Also check original title
      const origTitle = normalize(r.original_title || r.original_name || '');
      if (origTitle === needle) score += 80;
      else if (origTitle.startsWith(needle + ' ')) score += 40;

      // Year match (strong signal)
      if (searchYear) {
        const y = parseInt((r.release_date || r.first_air_date || '').slice(0, 4) || '0');
        if (y === searchYear) score += 50;
        else if (Math.abs(y - searchYear) === 1) score += 15;
      }

      // Popularity bonus — avoids obscure entries beating well-known films/shows
      score += Math.min((r.vote_count ?? 0) / 500, 20);

      return { result: r, score };
    });

    scored.sort((a, b) => b.score - a.score);
    this.logger.debug(
      `TMDB ranking for "${searchTitle}": ` +
      scored.slice(0, 3).map(s => `"${s.result.title || s.result.name}" [${s.score}]`).join(', '),
    );

    return scored[0].result;
  }

  async drainQueue(): Promise<{ cleaned: number }> {
    const [failed, completed] = await Promise.all([
      this.metadataQueue.clean(0, 1000, 'failed'),
      this.metadataQueue.clean(0, 1000, 'completed'),
    ]);
    await this.metadataQueue.drain();
    await this.syncGateway.emitStats();
    return { cleaned: failed.length + completed.length };
  }

  async enqueuePendingMetadata(): Promise<number> {
    const pending = await this.prisma.media.findMany({
      where: { syncStatus: { in: [SyncStatus.PENDING, SyncStatus.FAILED, SyncStatus.NOT_FOUND] } },
      select: { id: true },
    });
    if (pending.length === 0) return 0;

    await this.metadataQueue.addBulk(
      pending.map((m) => ({
        name: 'sync-metadata',
        data: { mediaId: m.id },
        opts: {
          jobId: `media-${m.id}`,
          attempts: 3,
          backoff: { type: 'exponential' as const, delay: 5000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      })),
    );
    return pending.length;
  }

  async syncSingleMedia(mediaId: number, { ignoreTmdbId = false } = {}) {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) throw new Error('Media not found');

    await this.prisma.media.update({ where: { id: mediaId }, data: { syncStatus: SyncStatus.SYNCING } });

    try {
      // Parse filename only — no folder heuristic
      const filename = media.nasPath.split('/').pop() || media.nasFilename;
      const parsed = parseMediaFilename(filename);

      // Title: admin-edited titleOriginal wins, otherwise ptt result from filename
      const title = media.titleOriginal || parsed.title || filename;
      const year = parsed.year;
      const isSeries = parsed.season !== undefined;

      this.logger.log(`[Sync #${mediaId}] File: "${filename}"`);

      // --- If tmdbId is set (manually by admin via edit form) and we're not forced to re-search ---
      if (media.tmdbId && !ignoreTmdbId) {
        this.logger.log(`[Sync #${mediaId}] tmdbId manually set to ${media.tmdbId}, skipping search`);
        const detectedType = isSeries ? MediaType.SERIES : (media.type ?? MediaType.MOVIE);
        if (detectedType === MediaType.SERIES) {
          await this.syncTvDetails(mediaId, media.tmdbId);
          if (parsed.season !== undefined && parsed.episode !== undefined) {
            await this.linkEpisodeFile(mediaId, media, parsed, media.tmdbId ?? undefined);
          }
        } else {
          await this.syncMovieDetails(mediaId, media.tmdbId);
        }
        this.logger.log(`[Sync #${mediaId}] ✓ Sync complete via manual tmdbId → SYNCED`);
        return;
      }

      this.logger.log(`[Sync #${mediaId}] Title resolved: "${title}"${year ? ` (${year})` : ''}`);
      this.logger.log(`[Sync #${mediaId}] Detected type: ${isSeries ? 'SERIES' : 'MOVIE'}`);

      let tmdbResult: any = null;
      let mediaType: MediaType;

      if (isSeries) {
        this.logger.log(`[Sync #${mediaId}] Searching TMDB TV: "${title}"${year ? ` year=${year}` : ''}`);
        const tvResults = await this.metadataService.searchTv(title, year);
        tmdbResult = this.pickBestResult(tvResults, title, year);
        if (!tmdbResult && year) {
          const tvNoYear = await this.metadataService.searchTv(title);
          tmdbResult = this.pickBestResult(tvNoYear, title, year);
        }
        if (tmdbResult) {
          mediaType = MediaType.SERIES;
          this.logger.log(`[Sync #${mediaId}] TV match: "${tmdbResult.name || tmdbResult.title}" (TMDB #${tmdbResult.id})`);
        } else {
          this.logger.log(`[Sync #${mediaId}] No TV match, trying movie search`);
          const movieResults = await this.metadataService.searchMovie(title, year);
          tmdbResult = this.pickBestResult(movieResults, title, year);
          mediaType = MediaType.MOVIE;
          if (tmdbResult) this.logger.log(`[Sync #${mediaId}] Movie match: "${tmdbResult.title}" (TMDB #${tmdbResult.id})`);
        }
      } else {
        this.logger.log(`[Sync #${mediaId}] Searching TMDB movie: "${title}"${year ? ` year=${year}` : ''}`);
        const movieResults = await this.metadataService.searchMovie(title, year);
        tmdbResult = this.pickBestResult(movieResults, title, year);
        if (!tmdbResult && year) {
          // Fallback: search without year in case TMDB has a slightly different release date
          const movieNoYear = await this.metadataService.searchMovie(title);
          tmdbResult = this.pickBestResult(movieNoYear, title, year);
        }
        if (tmdbResult) {
          mediaType = MediaType.MOVIE;
          this.logger.log(`[Sync #${mediaId}] Movie match: "${tmdbResult.title}" (TMDB #${tmdbResult.id})`);
        } else {
          this.logger.log(`[Sync #${mediaId}] No movie match, trying TV search`);
          const tvResults = await this.metadataService.searchTv(title, year);
          tmdbResult = this.pickBestResult(tvResults, title, year);
          mediaType = MediaType.SERIES;
          if (tmdbResult) this.logger.log(`[Sync #${mediaId}] TV match: "${tmdbResult.name}" (TMDB #${tmdbResult.id})`);
        }
      }

      if (!tmdbResult) {
        this.logger.warn(`[Sync #${mediaId}] No TMDB match found for "${title}"`);
        await this.prisma.media.update({
          where: { id: mediaId },
          data: { syncStatus: SyncStatus.NOT_FOUND, syncError: `Aucun résultat TMDB pour "${title}". Modifiez le titre de recherche et re-synchronisez.` },
        });
        return;
      }

      // --- Series episode deduplication ---
      // For series: if another Media record already represents this show, link the file as an episode
      if (mediaType === MediaType.SERIES) {
        const existingSeries = await this.prisma.media.findFirst({
          where: { tmdbId: tmdbResult.id, type: MediaType.SERIES, id: { not: mediaId } },
        });
        if (existingSeries) {
          this.logger.log(`[Sync #${mediaId}] Series episode → linking to existing series #${existingSeries.id} "${existingSeries.titleVf || existingSeries.titleOriginal}"`);
          await this.linkEpisodeFile(existingSeries.id, media, parsed, tmdbResult.id);
          await this.prisma.media.delete({ where: { id: mediaId } });
          return {
            redirectTo: {
              seriesId: existingSeries.id,
              season: parsed.season!,
              episode: parsed.episode!,
            },
          };
        }
      }
      // Movies with the same tmdbId are allowed (multiple copies/qualities on NAS)

      // Sync full details from TMDB
      this.logger.log(`[Sync #${mediaId}] Fetching full ${mediaType} details from TMDB #${tmdbResult.id}`);
      if (mediaType === MediaType.MOVIE) {
        await this.syncMovieDetails(mediaId, tmdbResult.id);
      } else {
        await this.syncTvDetails(mediaId, tmdbResult.id);
        // Also link this source episode file to its Episode record
        if (parsed.season !== undefined && parsed.episode !== undefined) {
          await this.linkEpisodeFile(mediaId, media, parsed, tmdbResult.id);
        }
      }
      this.logger.log(`[Sync #${mediaId}] ✓ Sync complete → SYNCED`);
    } catch (error: any) {
      await this.prisma.media.update({
        where: { id: mediaId },
        data: { syncStatus: SyncStatus.FAILED, syncError: error.message },
      });
      throw error;
    }
  }

  /**
   * Links a NAS episode file to the correct Season/Episode record of a series.
   * Creates the season if it doesn't exist yet (TMDB may not have synced it yet).
   */
  private async linkEpisodeFile(
    seriesMediaId: number,
    media: { nasPath: string; nasFilename: string; nasSize: bigint | null },
    parsed: ParsedMediaInfo,
    tmdbSeriesId?: number,
  ) {
    const seasonNumber = parsed.season ?? 1;
    const episodeNumber = parsed.episode;
    if (!episodeNumber) return;

    let season = await this.prisma.season.findUnique({
      where: { mediaId_seasonNumber: { mediaId: seriesMediaId, seasonNumber } },
    });

    if (!season) {
      season = await this.prisma.season.create({
        data: { mediaId: seriesMediaId, seasonNumber },
      });
    }

    // Fetch episode metadata from TMDB if we have the series ID
    let episodeMeta: { name?: string; overview?: string; runtime?: number | null; airDate?: Date | null; stillUrl?: string | null } = {};
    if (tmdbSeriesId) {
      const detail = await this.metadataService.getTvEpisodeDetail(tmdbSeriesId, seasonNumber, episodeNumber);
      if (detail) {
        episodeMeta = {
          name: detail.name || undefined,
          overview: detail.overview || undefined,
          runtime: detail.runtime ?? null,
          airDate: detail.air_date ? new Date(detail.air_date) : null,
          stillUrl: this.metadataService.stillUrl(detail.still_path),
        };
      }
    }

    await this.prisma.episode.upsert({
      where: { seasonId_episodeNumber: { seasonId: season.id, episodeNumber } },
      update: { nasPath: media.nasPath, nasFilename: media.nasFilename, nasSize: media.nasSize, ...episodeMeta },
      create: { seasonId: season.id, episodeNumber, nasPath: media.nasPath, nasFilename: media.nasFilename, nasSize: media.nasSize, ...episodeMeta },
    });
  }

  private async syncMovieDetails(mediaId: number, tmdbId: number) {
    const detail = await this.metadataService.getMovieDetail(tmdbId);

    const genreIds: number[] = [];
    for (const g of detail.genres) {
      const genre = await this.prisma.genre.upsert({
        where: { tmdbId: g.id },
        update: { name: g.name },
        create: { tmdbId: g.id, name: g.name },
      });
      genreIds.push(genre.id);
    }

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

    await this.prisma.mediaGenre.deleteMany({ where: { mediaId } });
    for (const genreId of genreIds) {
      await this.prisma.mediaGenre.create({ data: { mediaId, genreId } });
    }

    await this.prisma.mediaPerson.deleteMany({ where: { mediaId } });
    for (const p of persons) {
      await this.prisma.mediaPerson.create({ data: { mediaId, ...p } });
    }
  }

  private async syncTvDetails(mediaId: number, tmdbId: number) {
    const detail = await this.metadataService.getTvDetail(tmdbId);

    const genreIds: number[] = [];
    for (const g of detail.genres) {
      const genre = await this.prisma.genre.upsert({
        where: { tmdbId: g.id },
        update: { name: g.name },
        create: { tmdbId: g.id, name: g.name },
      });
      genreIds.push(genre.id);
    }

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

    await this.prisma.mediaGenre.deleteMany({ where: { mediaId } });
    for (const genreId of genreIds) {
      await this.prisma.mediaGenre.create({ data: { mediaId, genreId } });
    }

    await this.prisma.mediaPerson.deleteMany({ where: { mediaId } });
    for (const p of persons) {
      await this.prisma.mediaPerson.create({ data: { mediaId, ...p } });
    }

    for (const s of detail.seasons) {
      if (s.season_number === 0) continue;
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
