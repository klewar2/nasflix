import { Injectable, Logger, Inject, forwardRef, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { basename } from 'node:path';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma.service';
import { NasService } from '../nas/nas.service';
import { MetadataService, TmdbSearchResult } from '../metadata/metadata.service';
import { MediaType, SourceType, SyncStatus } from '@prisma/client';
import { parseMediaFilename, ParsedMediaInfo } from '../common/media-parser';
import { METADATA_SYNC_QUEUE } from './sync.constants';
import { SyncGateway } from './sync.gateway';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private isSyncing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly nasService: NasService,
    private readonly metadataService: MetadataService,
    @InjectQueue(METADATA_SYNC_QUEUE) private readonly metadataQueue: Queue,
    @Inject(forwardRef(() => SyncGateway)) private readonly syncGateway: SyncGateway,
  ) {}

  async fullSync(cineClubId: number, nasUsername: string, nasPassword: string, triggeredBy = 'manual') {
    if (this.isSyncing) {
      this.logger.warn('Sync already in progress, skipping');
      return { message: 'Sync already in progress' };
    }

    this.isSyncing = true;
    const syncLog = await this.prisma.syncLog.create({
      data: { cineClubId, type: 'full_scan', status: 'running', triggeredBy },
    });

    try {
      const club = await this.prisma.cineClub.findUniqueOrThrow({ where: { id: cineClubId } });
      if (!club.nasBaseUrl) throw new Error('NAS base URL not configured for this CineClub');

      // Step 1: Get all video files from NAS
      const session = await this.nasService.login(club.nasBaseUrl, nasUsername, nasPassword);
      const nasFiles = await this.nasService.listAllVideoFiles(session, club.nasSharedFolders);
      this.logger.log(`Found ${nasFiles.length} video files on NAS`);

      // Step 2: Reconcile Media records
      const existingMedia = await this.prisma.media.findMany({ where: { cineClubId }, select: { id: true, nasPath: true } });
      const nasPaths = new Set(nasFiles.map((f) => f.path));
      const orphaned = existingMedia.filter((m) => !nasPaths.has(m.nasPath));

      if (orphaned.length > 0) {
        this.logger.log(`Removing ${orphaned.length} orphaned Media entries`);
        await this.prisma.media.deleteMany({ where: { id: { in: orphaned.map((o) => o.id) } } });
      }

      // Step 2b: Reconcile Episode nasPath (episode files removed from NAS)
      const existingEpisodes = await this.prisma.episode.findMany({
        where: {
          nasPath: { not: null },
          season: { media: { cineClubId } },
        },
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

          const existing = await this.prisma.media.findUnique({ where: { cineClubId_nasPath: { cineClubId, nasPath: file.path } } });
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
              cineClubId,
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
        } catch (error: unknown) {
          errorCount++;
          const msg = error instanceof Error ? error.message : String(error);
          errors.push(`${file.name}: ${msg}`);
          this.logger.error(`Error processing ${file.name}: ${msg}`);
        }
      }

      // Step 4: Enqueue metadata sync for PENDING items
      const queued = await this.enqueuePendingMetadata(cineClubId);
      this.logger.log(`Enqueued ${queued} metadata sync jobs`);

      await this.nasService.logout(session);

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

      await this.prisma.cineClub.update({
        where: { id: cineClubId },
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
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      await this.prisma.syncLog.update({
        where: { id: syncLog.id },
        data: { status: 'failed', errorDetails: msg, completedAt: new Date() },
      });
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  async diffSync(cineClubId: number, changes: { added?: string[]; removed?: string[]; moved?: Array<{ from: string; to: string }> }) {
    const { added = [], removed = [], moved = [] } = changes;
    this.logger.log(`DiffSync [club ${cineClubId}]: +${added.length} added, -${removed.length} removed, ~${moved.length} moved`);

    // Suppressions
    if (removed.length > 0) {
      await this.prisma.media.deleteMany({ where: { cineClubId, nasPath: { in: removed } } });
      await this.prisma.episode.deleteMany({ where: { nasPath: { in: removed } } });
      this.logger.log(`Removed ${removed.length} file(s) from DB`);
    }

    // Déplacements / renommages
    let movedCount = 0;
    for (const { from, to } of moved) {
      const filename = to.split('/').pop() || '';
      const mediaUpdated = await this.prisma.media.updateMany({ where: { cineClubId, nasPath: from }, data: { nasPath: to, nasFilename: filename } });
      const episodeUpdated = await this.prisma.episode.updateMany({ where: { nasPath: from }, data: { nasPath: to, nasFilename: filename } });

      if (mediaUpdated.count === 0 && episodeUpdated.count === 0) {
        // Fallback: the NAS sent a folder path — find all files whose path starts with this prefix
        const fromPrefix = from.endsWith('/') ? from : `${from}/`;
        const toPrefix = to.endsWith('/') ? to : `${to}/`;

        const mediaInFolder = await this.prisma.media.findMany({ where: { cineClubId, nasPath: { startsWith: fromPrefix } } });
        for (const m of mediaInFolder) {
          const newPath = toPrefix + m.nasPath.slice(fromPrefix.length);
          await this.prisma.media.update({ where: { id: m.id }, data: { nasPath: newPath } });
          movedCount++;
        }

        const episodesInFolder = await this.prisma.episode.findMany({ where: { nasPath: { startsWith: fromPrefix } } });
        for (const e of episodesInFolder) {
          const newPath = toPrefix + e.nasPath!.slice(fromPrefix.length);
          const newFilename = newPath.split('/').pop() || '';
          await this.prisma.episode.update({ where: { id: e.id }, data: { nasPath: newPath, nasFilename: newFilename } });
          movedCount++;
        }
      } else {
        movedCount += mediaUpdated.count + episodeUpdated.count;
      }
    }
    if (moved.length > 0) {
      this.logger.log(`Updated ${movedCount} moved file(s) in DB`);
    }

    // Ajouts
    for (const filePath of added) {
      const filename = filePath.split('/').pop() || '';

      const episodeExists = await this.prisma.episode.findUnique({ where: { nasPath: filePath } });
      if (episodeExists) continue;
      const existing = await this.prisma.media.findUnique({ where: { cineClubId_nasPath: { cineClubId, nasPath: filePath } } });
      if (existing) continue;

      // Fallback: NAS sent file as "added" but it was actually moved (not detected as move)
      // If a SYNCED Media with the same filename exists at a different path, just update the path
      const sameFilename = await this.prisma.media.findFirst({
        where: { cineClubId, nasFilename: filename, syncStatus: SyncStatus.SYNCED, nasPath: { not: filePath } },
      });
      if (sameFilename) {
        await this.prisma.media.update({ where: { id: sameFilename.id }, data: { nasPath: filePath } });
        this.logger.log(`Moved (via added fallback): updated nasPath for media #${sameFilename.id} "${filename}"`);
        continue;
      }

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
          cineClubId,
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
      const queued = await this.enqueuePendingMetadata(cineClubId);
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

  async enqueuePendingMetadata(cineClubId: number): Promise<number> {
    const pending = await this.prisma.media.findMany({
      where: { cineClubId, syncStatus: { in: [SyncStatus.PENDING, SyncStatus.FAILED, SyncStatus.NOT_FOUND] } },
      select: { id: true },
    });
    if (pending.length === 0) return 0;

    await this.metadataQueue.addBulk(
      pending.map((m) => ({
        name: 'sync-metadata',
        data: { mediaId: m.id, cineClubId },
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

  async syncSingleMedia(mediaId: number, cineClubId: number) {
    const media = await this.prisma.media.findFirst({ where: { id: mediaId, cineClubId } });
    if (!media) throw new Error('Media not found');

    await this.prisma.media.update({ where: { id: mediaId }, data: { syncStatus: SyncStatus.SYNCING } });

    try {
      // Parse filename only — no folder heuristic
      const filename = media.nasPath.split('/').pop() || media.nasFilename;
      const parsed = parseMediaFilename(filename);

      // Title: admin-edited titleOriginal wins, otherwise ptt result from filename
      const title = media.titleOriginal || parsed.title || filename;
      const year = parsed.year;
      // For Jellyfin sources the nasPath is a UUID, so filename parsing gives no season info.
      // Fall back to the DB type so the title search uses the correct media type.
      const isSeries = parsed.season !== undefined || media.type === MediaType.SERIES;

      this.logger.log(`[Sync #${mediaId}] File: "${filename}"`);

      // --- If tmdbId is set (manually by admin via edit form), try it first ---
      // On failure (unknown id / TMDB 404), fall through to title+year search.
      if (media.tmdbId) {
        this.logger.log(`[Sync #${mediaId}] Trying pinned tmdbId=${media.tmdbId}`);
        try {
          if (media.type === MediaType.SERIES) {
            await this.syncTvDetails(mediaId, media.tmdbId, cineClubId);
            if (parsed.season !== undefined && parsed.episode !== undefined) {
              await this.linkEpisodeFile(mediaId, media, parsed, media.tmdbId ?? undefined, cineClubId);
            }
            await this.mergeSeriesByTmdbId(mediaId, media.tmdbId, cineClubId);
          } else {
            await this.syncMovieDetails(mediaId, media.tmdbId, cineClubId);
          }
          this.logger.log(`[Sync #${mediaId}] ✓ Sync complete via pinned tmdbId → SYNCED`);
          return;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`[Sync #${mediaId}] Pinned tmdbId ${media.tmdbId} failed (${msg}), falling back to title+year search`);
          await this.prisma.media.update({ where: { id: mediaId }, data: { tmdbId: null } });
        }
      }

      // Title for TMDB search: prefer admin-edited titleOriginal, then DB releaseYear as year hint
      const searchYear = year ?? (media.releaseYear ?? undefined);
      this.logger.log(`[Sync #${mediaId}] Title resolved: "${title}"${searchYear ? ` (${searchYear})` : ''}`);
      this.logger.log(`[Sync #${mediaId}] Detected type: ${isSeries ? 'SERIES' : 'MOVIE'}`);

      let tmdbResult: TmdbSearchResult | null = null;
      let mediaType: MediaType;

      if (isSeries) {
        this.logger.log(`[Sync #${mediaId}] Searching TMDB TV: "${title}"${searchYear ? ` year=${searchYear}` : ''}`);
        const tvResults = await this.metadataService.searchTv(title, searchYear, cineClubId);
        tmdbResult = this.pickBestResult(tvResults, title, searchYear);
        if (!tmdbResult && searchYear) {
          const tvNoYear = await this.metadataService.searchTv(title, undefined, cineClubId);
          tmdbResult = this.pickBestResult(tvNoYear, title, searchYear);
        }
        if (tmdbResult) {
          mediaType = MediaType.SERIES;
          this.logger.log(`[Sync #${mediaId}] TV match: "${tmdbResult.name || tmdbResult.title}" (TMDB #${tmdbResult.id})`);
        } else {
          this.logger.log(`[Sync #${mediaId}] No TV match, trying movie search`);
          const movieResults = await this.metadataService.searchMovie(title, searchYear, cineClubId);
          tmdbResult = this.pickBestResult(movieResults, title, searchYear);
          mediaType = MediaType.MOVIE;
          if (tmdbResult) this.logger.log(`[Sync #${mediaId}] Movie match: "${tmdbResult.title}" (TMDB #${tmdbResult.id})`);
        }
      } else {
        this.logger.log(`[Sync #${mediaId}] Searching TMDB movie: "${title}"${searchYear ? ` year=${searchYear}` : ''}`);
        const movieResults = await this.metadataService.searchMovie(title, searchYear, cineClubId);
        tmdbResult = this.pickBestResult(movieResults, title, searchYear);
        if (!tmdbResult && searchYear) {
          const movieNoYear = await this.metadataService.searchMovie(title, undefined, cineClubId);
          tmdbResult = this.pickBestResult(movieNoYear, title, searchYear);
        }
        if (tmdbResult) {
          mediaType = MediaType.MOVIE;
          this.logger.log(`[Sync #${mediaId}] Movie match: "${tmdbResult.title}" (TMDB #${tmdbResult.id})`);
        } else {
          this.logger.log(`[Sync #${mediaId}] No movie match, trying TV search`);
          const tvResults = await this.metadataService.searchTv(title, searchYear, cineClubId);
          tmdbResult = this.pickBestResult(tvResults, title, searchYear);
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

      // --- Series deduplication / cross-source merging ---
      // If another Media record already represents this show (same tmdbId), collapse into it.
      // Covers: NAS single-episode file joining an existing series, Jellyfin series arriving
      // after NAS (or vice-versa) — in the Jellyfin case seasons/episodes are already attached
      // and must be moved before deleting the source.
      if (mediaType! === MediaType.SERIES) {
        const existingSeries = await this.prisma.media.findFirst({
          where: { cineClubId, tmdbId: tmdbResult.id, type: MediaType.SERIES, id: { not: mediaId } },
        });
        if (existingSeries) {
          this.logger.log(`[Sync #${mediaId}] Existing series #${existingSeries.id} found for tmdbId=${tmdbResult.id} — merging`);
          if (parsed.season !== undefined && parsed.episode !== undefined) {
            await this.linkEpisodeFile(existingSeries.id, media, parsed, tmdbResult.id, cineClubId);
          }
          await this.mergeSeriesInto(mediaId, existingSeries.id);
          return {
            redirectTo: parsed.season !== undefined && parsed.episode !== undefined
              ? { seriesId: existingSeries.id, season: parsed.season, episode: parsed.episode }
              : { seriesId: existingSeries.id },
          };
        }
      }
      // Movies with the same tmdbId are allowed (multiple copies/qualities on NAS)

      // Sync full details from TMDB
      this.logger.log(`[Sync #${mediaId}] Fetching full ${mediaType!} details from TMDB #${tmdbResult.id}`);
      if (mediaType! === MediaType.MOVIE) {
        await this.syncMovieDetails(mediaId, tmdbResult.id, cineClubId);
      } else {
        await this.syncTvDetails(mediaId, tmdbResult.id, cineClubId);
        // Also link this source episode file to its Episode record
        if (parsed.season !== undefined && parsed.episode !== undefined) {
          await this.linkEpisodeFile(mediaId, media, parsed, tmdbResult.id, cineClubId);
        }
        // Safety net for race conditions where a duplicate appeared after the earlier check.
        await this.mergeSeriesByTmdbId(mediaId, tmdbResult.id, cineClubId);
      }
      this.logger.log(`[Sync #${mediaId}] ✓ Sync complete → SYNCED`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      await this.prisma.media.update({
        where: { id: mediaId },
        data: { syncStatus: SyncStatus.FAILED, syncError: msg },
      });
      throw error;
    }
  }

  /**
   * Ensures a single series Media per tmdbId per cineClub by merging any duplicates into `keepId`.
   */
  private async mergeSeriesByTmdbId(keepId: number, tmdbId: number, cineClubId: number) {
    const duplicates = await this.prisma.media.findMany({
      where: { cineClubId, tmdbId, type: MediaType.SERIES, id: { not: keepId } },
      select: { id: true },
    });
    for (const dup of duplicates) {
      await this.mergeSeriesInto(dup.id, keepId);
    }
  }

  /**
   * Moves seasons/episodes from `sourceId` into `destId` (conflict = prefer NAS, then merge fields),
   * transfers the Jellyfin id if missing, and deletes the source Media.
   */
  private async mergeSeriesInto(sourceId: number, destId: number) {
    if (sourceId === destId) return;
    const source = await this.prisma.media.findUnique({
      where: { id: sourceId },
      include: { seasons: { include: { episodes: true } } },
    });
    if (!source) return;

    for (const season of source.seasons) {
      const destSeason = await this.prisma.season.upsert({
        where: { mediaId_seasonNumber: { mediaId: destId, seasonNumber: season.seasonNumber } },
        update: {
          name: season.name ?? undefined,
          overview: season.overview ?? undefined,
          posterUrl: season.posterUrl ?? undefined,
          episodeCount: season.episodeCount ?? undefined,
          airDate: season.airDate ?? undefined,
        },
        create: {
          mediaId: destId,
          seasonNumber: season.seasonNumber,
          name: season.name,
          overview: season.overview,
          posterUrl: season.posterUrl,
          episodeCount: season.episodeCount,
          airDate: season.airDate,
        },
      });

      for (const ep of season.episodes) {
        const destEp = await this.prisma.episode.findUnique({
          where: { seasonId_episodeNumber: { seasonId: destSeason.id, episodeNumber: ep.episodeNumber } },
        });
        if (!destEp) {
          await this.prisma.episode.update({ where: { id: ep.id }, data: { seasonId: destSeason.id } });
          continue;
        }
        const update: Record<string, unknown> = {};
        if (!destEp.nasPath && ep.nasPath) {
          update.nasPath = ep.nasPath;
          update.nasFilename = ep.nasFilename;
          update.nasSize = ep.nasSize;
          update.sourceType = SourceType.NAS;
        }
        if (!destEp.jellyfinItemId && ep.jellyfinItemId) {
          update.jellyfinItemId = ep.jellyfinItemId;
          if (!destEp.nasPath && !update.nasPath) update.sourceType = SourceType.SEEDBOX;
        }
        if (!destEp.name && ep.name) update.name = ep.name;
        if (!destEp.overview && ep.overview) update.overview = ep.overview;
        if (!destEp.runtime && ep.runtime) update.runtime = ep.runtime;
        if (!destEp.airDate && ep.airDate) update.airDate = ep.airDate;
        if (!destEp.stillUrl && ep.stillUrl) update.stillUrl = ep.stillUrl;
        if (Object.keys(update).length > 0) {
          await this.prisma.episode.update({ where: { id: destEp.id }, data: update });
        }
        await this.prisma.episode.delete({ where: { id: ep.id } });
      }
      await this.prisma.season.delete({ where: { id: season.id } });
    }

    if (source.jellyfinItemId) {
      const dest = await this.prisma.media.findUnique({ where: { id: destId }, select: { jellyfinItemId: true } });
      if (!dest?.jellyfinItemId) {
        await this.prisma.media.update({ where: { id: destId }, data: { jellyfinItemId: source.jellyfinItemId } });
      }
    }

    await this.prisma.media.delete({ where: { id: sourceId } });
    this.logger.log(`Merged series #${sourceId} → #${destId}`);
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
    cineClubId?: number,
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
      const detail = await this.metadataService.getTvEpisodeDetail(tmdbSeriesId, seasonNumber, episodeNumber, cineClubId);
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

  private async syncMovieDetails(mediaId: number, tmdbId: number, cineClubId?: number) {
    const detail = await this.metadataService.getMovieDetail(tmdbId, cineClubId);

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

  private async syncTvDetails(mediaId: number, tmdbId: number, cineClubId?: number) {
    const detail = await this.metadataService.getTvDetail(tmdbId, cineClubId);

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
      const season = await this.prisma.season.upsert({
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

      const seasonDetail = await this.metadataService.getTvSeasonDetail(tmdbId, s.season_number, cineClubId);
      if (seasonDetail) {
        for (const ep of seasonDetail.episodes) {
          if (!ep.episode_number) continue; // skip specials or malformed TMDB entries
          const stillUrl = this.metadataService.stillUrl(ep.still_path);
          try {
            await this.prisma.episode.upsert({
              where: { seasonId_episodeNumber: { seasonId: season.id, episodeNumber: ep.episode_number } },
              update: {
                name: ep.name || undefined,
                overview: ep.overview || undefined,
                airDate: ep.air_date ? new Date(ep.air_date) : undefined,
                ...(stillUrl ? { stillUrl } : {}),
                ...(ep.runtime ? { runtime: ep.runtime } : {}),
              },
              create: {
                seasonId: season.id,
                episodeNumber: ep.episode_number,
                name: ep.name,
                overview: ep.overview,
                airDate: ep.air_date ? new Date(ep.air_date) : null,
                stillUrl,
                runtime: ep.runtime ?? null,
              },
            });
          } catch (epErr) {
            const msg = epErr instanceof Error ? epErr.message : String(epErr);
            this.logger.warn(`[syncTvDetails] Episode S${s.season_number}E${ep.episode_number} upsert failed: ${msg}`);
          }
        }
      }
    }
  }

  async syncFromJellyfin(cineClubId: number): Promise<object> {
    const club = await this.prisma.cineClub.findUniqueOrThrow({ where: { id: cineClubId } });
    if (!club.jellyfinBaseUrl || !club.jellyfinApiToken) {
      throw new BadRequestException('Jellyfin non configuré pour ce CineClub');
    }

    const syncLog = await this.prisma.syncLog.create({
      data: { cineClubId, type: 'jellyfin_sync', status: 'running', triggeredBy: 'manual' },
    });

    let processedItems = 0;
    let errorCount = 0;
    const errors: string[] = [];

    try {
      const [movies, episodes] = await Promise.all([
        this.nasService.getJellyfinItems(club.jellyfinBaseUrl, club.jellyfinApiToken, 'Movie'),
        this.nasService.getJellyfinItems(club.jellyfinBaseUrl, club.jellyfinApiToken, 'Episode'),
      ]);

      this.logger.log(`[Jellyfin sync] ${movies.length} films, ${episodes.length} épisodes`);

      for (const item of movies) {
        try {
          const filePath = item.Path;
          const filename = basename(filePath);
          const runtime = item.RunTimeTicks ? Math.round(item.RunTimeTicks / 600_000_000) : null;

          const existing = await this.prisma.media.findUnique({
            where: { cineClubId_nasPath: { cineClubId, nasPath: filePath } },
          });

          if (existing) {
            await this.prisma.media.update({
              where: { id: existing.id },
              data: { jellyfinItemId: item.Id, sourceType: SourceType.SEEDBOX, ...(runtime ? { runtime } : {}) },
            });
          } else {
            const parsed = parseMediaFilename(filename);
            await this.prisma.media.create({
              data: {
                cineClubId,
                type: MediaType.MOVIE,
                titleOriginal: item.Name || parsed.title || filename,
                nasPath: filePath,
                nasFilename: filename,
                sourceType: SourceType.SEEDBOX,
                jellyfinItemId: item.Id,
                runtime,
                syncStatus: SyncStatus.PENDING,
                nasAddedAt: new Date(),
              },
            });
          }
          processedItems++;
        } catch (err) {
          errorCount++;
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${item.Name}: ${msg}`);
          this.logger.error(`[Jellyfin sync] Error processing movie "${item.Name}": ${msg}`);
        }
      }

      // ── Series / Episodes ─────────────────────────────────────────────
      // Group episodes by SeriesId to upsert one Media(SERIES) per show
      const seriesMap = new Map<string, Array<{ Id: string; Name: string; Path: string; RunTimeTicks?: number; SeriesName?: string; SeriesId?: string; IndexNumber?: number; ParentIndexNumber?: number }>>();
      for (const ep of episodes) {
        if (!ep.SeriesId) continue;
        if (!seriesMap.has(ep.SeriesId)) seriesMap.set(ep.SeriesId, []);
        seriesMap.get(ep.SeriesId)!.push(ep);
      }

      for (const [seriesId, seriesEpisodes] of seriesMap) {
        const seriesName = seriesEpisodes[0].SeriesName ?? 'Unknown';
        // Stable synthetic path so we can find/update across syncs
        const syntheticPath = `jellyfin://${seriesId}`;

        try {
          // Prefer an existing Media linked to this Jellyfin series (it may have been merged
          // into a NAS-sourced series Media with a different nasPath).
          let seriesMedia = await this.prisma.media.findFirst({
            where: { cineClubId, jellyfinItemId: seriesId, type: MediaType.SERIES },
          });
          if (!seriesMedia) {
            seriesMedia = await this.prisma.media.findUnique({
              where: { cineClubId_nasPath: { cineClubId, nasPath: syntheticPath } },
            });
          }

          if (!seriesMedia) {
            seriesMedia = await this.prisma.media.create({
              data: {
                cineClubId,
                type: MediaType.SERIES,
                titleOriginal: seriesName,
                nasPath: syntheticPath,
                nasFilename: seriesName,
                sourceType: SourceType.SEEDBOX,
                jellyfinItemId: seriesId,
                syncStatus: SyncStatus.PENDING,
                nasAddedAt: new Date(),
              },
            });
          } else {
            await this.prisma.media.update({
              where: { id: seriesMedia.id },
              data: { jellyfinItemId: seriesId },
            });
          }

          for (const ep of seriesEpisodes) {
            try {
              const seasonNumber = ep.ParentIndexNumber ?? 1;
              const episodeNumber = ep.IndexNumber ?? 1;
              const runtime = ep.RunTimeTicks ? Math.round(ep.RunTimeTicks / 600_000_000) : null;
              const epFilename = ep.Path ? basename(ep.Path) : ep.Name;

              // Find or create season
              let season = await this.prisma.season.findUnique({
                where: { mediaId_seasonNumber: { mediaId: seriesMedia.id, seasonNumber } },
              });
              if (!season) {
                season = await this.prisma.season.create({
                  data: { mediaId: seriesMedia.id, seasonNumber, name: `Saison ${seasonNumber}` },
                });
              }

              // Preserve an existing NAS source on the episode — Jellyfin should layer on top,
              // not overwrite. We still record the Jellyfin id so the file can be streamed.
              const existingEp = await this.prisma.episode.findUnique({
                where: { seasonId_episodeNumber: { seasonId: season.id, episodeNumber } },
              });
              if (!existingEp) {
                await this.prisma.episode.create({
                  data: {
                    seasonId: season.id,
                    episodeNumber,
                    name: ep.Name,
                    nasPath: ep.Path || null,
                    nasFilename: epFilename,
                    sourceType: SourceType.SEEDBOX,
                    jellyfinItemId: ep.Id,
                    runtime,
                  },
                });
              } else {
                const hasNas = existingEp.sourceType === SourceType.NAS && !!existingEp.nasPath;
                await this.prisma.episode.update({
                  where: { id: existingEp.id },
                  data: hasNas
                    ? { jellyfinItemId: ep.Id, ...(runtime && !existingEp.runtime ? { runtime } : {}) }
                    : {
                        nasPath: ep.Path || undefined,
                        nasFilename: epFilename,
                        sourceType: SourceType.SEEDBOX,
                        jellyfinItemId: ep.Id,
                        ...(runtime ? { runtime } : {}),
                      },
                });
              }
              processedItems++;
            } catch (epErr) {
              errorCount++;
              const msg = epErr instanceof Error ? epErr.message : String(epErr);
              errors.push(`${seriesName} S${ep.ParentIndexNumber ?? 1}E${ep.IndexNumber ?? 1}: ${msg}`);
            }
          }
        } catch (seriesErr) {
          errorCount++;
          const msg = seriesErr instanceof Error ? seriesErr.message : String(seriesErr);
          errors.push(`Series "${seriesName}": ${msg}`);
          this.logger.error(`[Jellyfin sync] Error processing series "${seriesName}": ${msg}`);
        }
      }

      // Enqueue metadata sync for new PENDING items
      const queued = await this.enqueuePendingMetadata(cineClubId);

      await this.prisma.syncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'completed',
          totalItems: movies.length + episodes.length,
          processedItems,
          errorCount,
          errorDetails: errors.length > 0 ? JSON.stringify(errors) : null,
          completedAt: new Date(),
        },
      });

      return {
        message: 'Sync Jellyfin terminée',
        movies: movies.length,
        episodes: episodes.length,
        processed: processedItems,
        errors: errorCount,
        metadataQueued: queued,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.prisma.syncLog.update({
        where: { id: syncLog.id },
        data: { status: 'failed', errorDetails: msg, completedAt: new Date() },
      });
      throw err;
    }
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async autoSyncJellyfin() {
    const clubs = await this.prisma.cineClub.findMany({
      where: { jellyfinBaseUrl: { not: null }, jellyfinApiToken: { not: null } },
      select: { id: true, name: true },
    });

    for (const club of clubs) {
      try {
        this.logger.log(`[Auto-sync Jellyfin] Démarrage pour "${club.name}" (id=${club.id})`);
        await this.syncFromJellyfin(club.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[Auto-sync Jellyfin] Erreur pour "${club.name}": ${msg}`);
      }
    }
  }

  async getSyncLogs(cineClubId: number, page = 1, limit = 20) {
    const [data, total] = await Promise.all([
      this.prisma.syncLog.findMany({
        where: { cineClubId },
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.syncLog.count({ where: { cineClubId } }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
