import { Injectable, Logger, Inject, forwardRef, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { basename } from 'node:path';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma.service';
import { NasService } from '../nas/nas.service';
import { MetadataService, TmdbSearchResult } from '../metadata/metadata.service';
import { JobKind, JobStatus, MediaType, SourceType, SyncStatus } from '@prisma/client';
import { parseMediaFilename, ParsedMediaInfo } from '../common/media-parser';
import { METADATA_SYNC_QUEUE } from './sync.constants';
import { SyncGateway } from './sync.gateway';
import { JobsService } from '../jobs/jobs.service';

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
    private readonly jobsService: JobsService,
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

      // Step 2: Reconcile Media records — détection move (filename+size) puis delete avec grâce
      const reconcile = await this.reconcileNasFiles(cineClubId, nasFiles, club.seedboxDeleteGraceHours);
      const orphanedCount = reconcile.deletedDetected;
      if (reconcile.skippedDueToEmptyNas) {
        this.logger.warn(`NAS returned 0 files mais des Media existent — skip réconciliation (NAS peut-être offline)`);
      } else {
        this.logger.log(
          `Réconciliation NAS : ${reconcile.moved} déplacement(s), ${reconcile.deletedDetected} suppression(s) détectée(s)`,
        );
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
        deletionsDetected: orphanedCount,
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

    // Suppressions : ne supprime PAS la Media, on marque nasDeletedAt
    // et on planifie une suppression seedbox avec grâce (annulable par super admin).
    if (removed.length > 0) {
      const club = await this.prisma.cineClub.findUnique({ where: { id: cineClubId } });
      const graceMs = (club?.seedboxDeleteGraceHours ?? 24) * 60 * 60 * 1000;
      await this.markDeletedAndQueueCleanup(cineClubId, removed, graceMs);
      this.logger.log(`Marked ${removed.length} file(s) deleted (grâce ${graceMs / 3600_000}h)`);
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
      // On TMDB 404 / network error, fall through to title+year search.
      if (media.tmdbId) {
        this.logger.log(`[Sync #${mediaId}] Trying pinned tmdbId=${media.tmdbId}`);
        try {
          if (media.type === MediaType.SERIES) {
            await this.syncTvDetails(mediaId, media.tmdbId, cineClubId);
            // syncTvDetails succeeded and already set syncStatus=SYNCED.
            // Run post-sync helpers non-throwingly so a merge error doesn't corrupt the result.
            if (parsed.season !== undefined && parsed.episode !== undefined) {
              await this.linkEpisodeFile(mediaId, media, parsed, media.tmdbId, cineClubId).catch((e) =>
                this.logger.warn(`[Sync #${mediaId}] linkEpisodeFile failed: ${e instanceof Error ? e.message : String(e)}`),
              );
            }
            await this.mergeSeriesByTmdbId(mediaId, media.tmdbId, cineClubId).catch((e) =>
              this.logger.warn(`[Sync #${mediaId}] mergeSeriesByTmdbId failed: ${e instanceof Error ? e.message : String(e)}`),
            );
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
        // Jellyfin a la priorité : si la source a un jellyfinItemId, on l'applique
        // et on bascule en SEEDBOX (même si destEp est sur NAS).
        if (!destEp.jellyfinItemId && ep.jellyfinItemId) {
          update.jellyfinItemId = ep.jellyfinItemId;
          update.sourceType = SourceType.SEEDBOX;
        }
        // nasPath : ne copier que si destEp n'en a pas ET qu'il n'y a pas de conflit
        // (la même nasPath peut déjà appartenir à un autre épisode en DB).
        if (!destEp.nasPath && ep.nasPath) {
          const conflict = await this.prisma.episode.findFirst({
            where: { nasPath: ep.nasPath, id: { not: destEp.id } },
          });
          if (!conflict) {
            update.nasPath = ep.nasPath;
            update.nasFilename = ep.nasFilename;
            update.nasSize = ep.nasSize;
            if (!update.sourceType) update.sourceType = SourceType.NAS;
          }
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
    await this.prisma.media.update({ where: { id: destId }, data: { nasAddedAt: new Date() } });
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

    await this.prisma.media.update({
      where: { id: seriesMediaId },
      data: { nasAddedAt: new Date() },
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
            // Only enrich episodes that already exist (have a file on NAS or Jellyfin).
            // Never create episodes from TMDB alone — files drive episode creation.
            await this.prisma.episode.updateMany({
              where: { seasonId: season.id, episodeNumber: ep.episode_number },
              data: {
                ...(ep.name ? { name: ep.name } : {}),
                ...(ep.overview ? { overview: ep.overview } : {}),
                ...(ep.air_date ? { airDate: new Date(ep.air_date) } : {}),
                ...(stillUrl ? { stillUrl } : {}),
                ...(ep.runtime ? { runtime: ep.runtime } : {}),
              },
            });
          } catch (epErr) {
            const msg = epErr instanceof Error ? epErr.message : String(epErr);
            this.logger.warn(`[syncTvDetails] Episode S${s.season_number}E${ep.episode_number} update failed: ${msg}`);
          }
        }
      }
    }
  }


  // ── Réconciliation NAS (move + delete avec grâce) ─────────────────────────

  private async reconcileNasFiles(
    cineClubId: number,
    nasFiles: Array<{ path: string; name: string; additional?: { size?: string | number } }>,
    graceHours: number,
  ): Promise<{ moved: number; deletedDetected: number; skippedDueToEmptyNas: boolean }> {
    const existingMedia = await this.prisma.media.findMany({
      where: { cineClubId },
      select: { id: true, nasPath: true, nasFilename: true, nasSize: true },
    });
    const nasMediaCount = existingMedia.filter((m) => !m.nasPath.startsWith('jellyfin://')).length;

    if (nasFiles.length === 0 && nasMediaCount > 0) {
      return { moved: 0, deletedDetected: 0, skippedDueToEmptyNas: true };
    }

    const nasPaths = new Set(nasFiles.map((f) => f.path));
    // Index NAS par (filename, size) pour détection move
    const nasIndexBySig = new Map<string, { path: string; name: string }>();
    for (const f of nasFiles) {
      const size = f.additional?.size != null ? String(f.additional.size) : '?';
      const sig = `${f.name}|${size}`;
      if (!nasIndexBySig.has(sig)) nasIndexBySig.set(sig, { path: f.path, name: f.name });
    }

    // Media manquantes côté NAS : tenter move puis fallback delete
    const missingMedia = existingMedia.filter(
      (m) => !m.nasPath.startsWith('jellyfin://') && !nasPaths.has(m.nasPath),
    );

    let moved = 0;
    const toDelete: string[] = [];
    for (const m of missingMedia) {
      const sig = `${m.nasFilename}|${m.nasSize != null ? String(m.nasSize) : '?'}`;
      const hit = nasIndexBySig.get(sig);
      if (hit && hit.path !== m.nasPath) {
        await this.prisma.media.update({
          where: { id: m.id },
          data: { nasPath: hit.path, nasFilename: hit.name, nasDeletedAt: null },
        });
        moved++;
      } else {
        toDelete.push(m.nasPath);
      }
    }

    // Episodes (par nasPath unique sur Episode)
    const existingEpisodes = await this.prisma.episode.findMany({
      where: { nasPath: { not: null }, season: { media: { cineClubId } } },
      select: { id: true, nasPath: true, nasFilename: true, nasSize: true },
    });
    const missingEpisodes = existingEpisodes.filter((e) => e.nasPath && !nasPaths.has(e.nasPath));
    const episodesToDelete: string[] = [];
    for (const e of missingEpisodes) {
      const sig = `${e.nasFilename}|${e.nasSize != null ? String(e.nasSize) : '?'}`;
      const hit = nasIndexBySig.get(sig);
      if (hit && hit.path !== e.nasPath) {
        await this.prisma.episode.update({
          where: { id: e.id },
          data: { nasPath: hit.path, nasFilename: hit.name, nasDeletedAt: null },
        });
        moved++;
      } else if (e.nasPath) {
        episodesToDelete.push(e.nasPath);
      }
    }

    const allToDelete = [...toDelete, ...episodesToDelete];
    if (allToDelete.length > 0) {
      await this.markDeletedAndQueueCleanup(cineClubId, allToDelete, graceHours * 60 * 60 * 1000);
    }

    return { moved, deletedDetected: allToDelete.length, skippedDueToEmptyNas: false };
  }

  // Marque les Media/Episode comme supprimés sur le NAS (nasDeletedAt) et planifie
  // une suppression seedbox (DELETE_FROM_SEEDBOX, grâce 24h par défaut, annulable).
  private async markDeletedAndQueueCleanup(
    cineClubId: number,
    nasPaths: string[],
    delayMs: number,
  ): Promise<void> {
    if (nasPaths.length === 0) return;
    const now = new Date();

    const mediasToMark = await this.prisma.media.findMany({
      where: { cineClubId, nasPath: { in: nasPaths }, nasDeletedAt: null },
      select: { id: true, nasPath: true, nasFilename: true },
    });
    if (mediasToMark.length > 0) {
      await this.prisma.media.updateMany({
        where: { id: { in: mediasToMark.map((m) => m.id) } },
        data: { nasDeletedAt: now },
      });
    }

    const episodesToMark = await this.prisma.episode.findMany({
      where: { nasPath: { in: nasPaths }, nasDeletedAt: null, season: { media: { cineClubId } } },
      select: { id: true, nasPath: true, nasFilename: true },
    });
    if (episodesToMark.length > 0) {
      await this.prisma.episode.updateMany({
        where: { id: { in: episodesToMark.map((e) => e.id) } },
        data: { nasDeletedAt: now },
      });
    }

    // Pour chaque Media/Episode, on tente de retrouver le chemin seedbox via le Job d'origine
    for (const m of mediasToMark) {
      const lastTransfer = await this.prisma.job.findFirst({
        where: { mediaId: m.id, kind: JobKind.DOWNLOAD_TO_NAS, status: JobStatus.COMPLETED, sourcePath: { not: null } },
        orderBy: { completedAt: 'desc' },
      });
      if (!lastTransfer?.sourcePath) {
        this.logger.warn(`Media ${m.id} supprimée du NAS mais aucun Job d'origine — pas de nettoyage seedbox automatique`);
        continue;
      }
      // Skip si déjà un job de cleanup actif/planifié pour ce path
      const existing = await this.prisma.job.findFirst({
        where: {
          cineClubId,
          kind: JobKind.DELETE_FROM_SEEDBOX,
          sourcePath: lastTransfer.sourcePath,
          status: { in: [JobStatus.PENDING, JobStatus.AWAITING_NAS, JobStatus.AWAITING_SEEDBOX, JobStatus.IN_PROGRESS] },
        },
      });
      if (existing) continue;
      await this.jobsService.createSeedboxDeletionJob({
        cineClubId,
        sourcePath: lastTransfer.sourcePath,
        fileName: m.nasFilename,
        mediaId: m.id,
        delayMs,
        triggeredBy: 'nas-sync',
      });
    }
    for (const e of episodesToMark) {
      const lastTransfer = await this.prisma.job.findFirst({
        where: { episodeId: e.id, kind: JobKind.DOWNLOAD_TO_NAS, status: JobStatus.COMPLETED, sourcePath: { not: null } },
        orderBy: { completedAt: 'desc' },
      });
      if (!lastTransfer?.sourcePath) {
        this.logger.warn(`Episode ${e.id} supprimé du NAS mais aucun Job d'origine — pas de nettoyage seedbox automatique`);
        continue;
      }
      const existing = await this.prisma.job.findFirst({
        where: {
          cineClubId,
          kind: JobKind.DELETE_FROM_SEEDBOX,
          sourcePath: lastTransfer.sourcePath,
          status: { in: [JobStatus.PENDING, JobStatus.AWAITING_NAS, JobStatus.AWAITING_SEEDBOX, JobStatus.IN_PROGRESS] },
        },
      });
      if (existing) continue;
      await this.jobsService.createSeedboxDeletionJob({
        cineClubId,
        sourcePath: lastTransfer.sourcePath,
        fileName: e.nasFilename ?? lastTransfer.sourcePath.split('/').pop() ?? 'episode.mkv',
        episodeId: e.id,
        delayMs,
        triggeredBy: 'nas-sync',
      });
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
