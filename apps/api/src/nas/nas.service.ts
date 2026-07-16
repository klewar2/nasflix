import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException, ForbiddenException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSocket } from 'node:dgram';
import { lookup } from 'node:dns/promises';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as https from 'node:https';
import * as http from 'node:http';
import { Client as SshClient } from 'ssh2';
import { PrismaService } from '../common/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { parseMediaFilename } from '../common/media-parser';
import { NasGateway } from './nas.gateway';

interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function fetchInsecure(url: string, init: FetchInit = {}, timeoutMs = 10000): Promise<{ json: () => Promise<unknown> }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      rejectUnauthorized: false,
      timeout: timeoutMs,
    };
    const lib = isHttps ? https : http;
    const req = lib.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        resolve({ json: () => Promise.resolve(JSON.parse(text)) });
      });
    });
    req.on('timeout', () => { req.destroy(new Error(`Timeout (${timeoutMs}ms) — URL injoignable : ${url}`)); });
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}
 
const ffmpegPath: string = require('ffmpeg-static');

// Même échappement shell que jobs.processor (rsync) — sûr pour sh/bash/busybox
function shellEscape(s: string): string {
  if (s === '') return "''";
  if (/^[a-zA-Z0-9_\-./@:=,]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

interface SynoResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: number };
}

interface VideoStationFile {
  id: string;
  path: string;
  size?: number;
}

export interface AudioTrackInfo {
  index: number;
  language: string;
  title: string;
  codec: string;
  channels: number;
}

export interface SubtitleTrackInfo {
  index: number;
  language: string;
  title: string;
  codec: string;
  jellyfinIndex?: number;
}

export interface MediaTracks {
  audio: AudioTrackInfo[];
  subtitles: SubtitleTrackInfo[];
}

export interface NasSubtitleTrack {
  trackIdx: number;
  language: string;
  title: string;
  codec: string;
  vttContent: string;
  /** Extraction encore en cours : le client re-sonde le endpoint jusqu'au VTT. */
  pending?: boolean;
  /** Progression de l'extraction (% du fichier lu depuis le NAS). */
  progressPercent?: number;
}


export interface SynoFileInfo {
  path: string;
  name: string;
  isdir: boolean;
  additional?: {
    size?: number | string;
    time?: { mtime?: number; crtime?: number; atime?: number; ctime?: number };
    real_path?: string;
  };
}

export interface NasSession {
  baseUrl: string;
  sid: string;
}

@Injectable()
export class NasService implements OnModuleInit {
  private readonly logger = new Logger(NasService.name);

  /** Évite deux logins FileStation concurrents (même NAS / même user) : la 2ᵉ session invalide souvent la 1ʳᵉ → 404 sur fileproxy. */
  private readonly fileStationSessionTtlMs = 4 * 60 * 1000;
  private fileStationSidByKey = new Map<string, { sid: string; expiresAt: number }>();
  private fileStationLoginInFlight = new Map<string, Promise<NasSession>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly nasGateway: NasGateway,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Au boot : reset les flags `nasWakeInProgress` des cineclubs dont le timer a expiré
   * (évite les états bloqués si l'API a crashé en plein wake).
   */
  async onModuleInit() {
    try {
      const clubs = await this.prisma.cineClub.findMany({
        where: { nasWakeInProgress: true },
        select: { id: true, nasWakeStartedAt: true, nasWolWaitSeconds: true },
      });
      const now = Date.now();
      for (const club of clubs) {
        const startedAt = club.nasWakeStartedAt?.getTime() ?? 0;
        const timeoutMs = (club.nasWolWaitSeconds || 300) * 1000;
        if (now - startedAt > timeoutMs) {
          await this.prisma.cineClub.update({
            where: { id: club.id },
            data: { nasWakeInProgress: false, nasWakeStartedAt: null, nasWakeStartedByUserId: null },
          });
          this.logger.warn(`[WoL] Reset flag wake bloqué pour cineClub#${club.id}`);
        }
      }
    } catch (err) {
      this.logger.error(`[WoL] onModuleInit reset failed: ${err}`);
    }
  }

  /** État NAS enrichi pour le frontend (online + wake en cours). */
  async getNasStatusForCineClub(cineClubId: number): Promise<{
    online: boolean;
    wakeInProgress: boolean;
    wakeStartedAt: string | null;
    wakeStartedByUserId: number | null;
    wakeTimeoutSeconds: number;
  }> {
    const club = await this.prisma.cineClub.findUnique({
      where: { id: cineClubId },
      select: {
        nasBaseUrl: true,
        nasWakeInProgress: true,
        nasWakeStartedAt: true,
        nasWakeStartedByUserId: true,
        nasWolWaitSeconds: true,
      },
    });
    const wakeTimeoutSeconds = club?.nasWolWaitSeconds || 300;

    if (!club?.nasBaseUrl) {
      return {
        online: false,
        wakeInProgress: !!club?.nasWakeInProgress,
        wakeStartedAt: club?.nasWakeStartedAt?.toISOString() ?? null,
        wakeStartedByUserId: club?.nasWakeStartedByUserId ?? null,
        wakeTimeoutSeconds,
      };
    }

    const online = await this.checkStatusForCineClub(cineClubId);

    // Si online + un wake était en cours, reset les flags (cas : NAS répond avant la fin du poll).
    if (online && club.nasWakeInProgress) {
      await this.prisma.cineClub.update({
        where: { id: cineClubId },
        data: { nasWakeInProgress: false, nasWakeStartedAt: null, nasWakeStartedByUserId: null },
      });
      this.nasGateway.emitNasOnline(cineClubId);
      return { online: true, wakeInProgress: false, wakeStartedAt: null, wakeStartedByUserId: null, wakeTimeoutSeconds };
    }

    return {
      online,
      wakeInProgress: club.nasWakeInProgress,
      wakeStartedAt: club.nasWakeStartedAt?.toISOString() ?? null,
      wakeStartedByUserId: club.nasWakeStartedByUserId,
      wakeTimeoutSeconds,
    };
  }

  private fileStationSessionKey(baseUrl: string, username: string): string {
    return `${baseUrl.replace(/\/$/, '')}\u0000${username}`;
  }

  /** Session FileStation réutilisée (TTL court) + une seule promesse en vol par clé. */
  async getFileStationSession(baseUrl: string, username: string, password: string): Promise<NasSession> {
    const key = this.fileStationSessionKey(baseUrl, username);
    const now = Date.now();
    const cached = this.fileStationSidByKey.get(key);
    if (cached && cached.expiresAt > now) {
      return { baseUrl, sid: cached.sid };
    }
    let pending = this.fileStationLoginInFlight.get(key);
    if (!pending) {
      pending = (async () => {
        try {
          const session = await this.login(baseUrl, username, password, 'FileStation');
          this.fileStationSidByKey.set(key, { sid: session.sid, expiresAt: Date.now() + this.fileStationSessionTtlMs });
          return session;
        } finally {
          this.fileStationLoginInFlight.delete(key);
        }
      })();
      this.fileStationLoginInFlight.set(key, pending);
    }
    return pending;
  }

  private async request<T>(baseUrl: string, params: Record<string, string>): Promise<SynoResponse<T>> {
    const url = new URL('/webapi/entry.cgi', baseUrl);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    return response.json() as Promise<SynoResponse<T>>;
  }

  /**
   * POST form-urlencoded — format utilisé par VideoStation web pour les paramètres complexes.
   * Les valeurs objet/tableau sont sérialisées en JSON string dans le body.
   * Le _sid est envoyé en query param URL (obligatoire pour les APIs Synology).
   */
  private async requestFormPost<T>(
    baseUrl: string,
    sid: string,
    fields: Record<string, unknown>,
  ): Promise<SynoResponse<T>> {
    const url = new URL('/webapi/entry.cgi', baseUrl);
    url.searchParams.set('_sid', sid);

    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) {
      body.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    }

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(15000),
    });
    return response.json() as Promise<SynoResponse<T>>;
  }

  async login(baseUrl: string, username: string, password: string, session = 'FileStation'): Promise<NasSession> {
    const url = new URL('/webapi/auth.cgi', baseUrl);
    url.searchParams.set('api', 'SYNO.API.Auth');
    url.searchParams.set('version', '6');
    url.searchParams.set('method', 'login');
    url.searchParams.set('account', username);
    url.searchParams.set('passwd', password);
    url.searchParams.set('session', session);
    url.searchParams.set('format', 'sid');

    this.logger.log(`[login] url=${url.toString().replace(/(passwd=)[^&]+/, '$1***')}`);
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    const result: SynoResponse<{ sid: string }> = await response.json();
    this.logger.log(`[login] httpStatus=${response.status} success=${result.success} error=${JSON.stringify(result.error ?? null)} sid=${result.data?.sid?.slice(0, 8) ?? 'none'}…`);

    if (!result.success || !result.data?.sid) {
      throw new Error(`Connexion NAS échouée : ${JSON.stringify(result.error)}`);
    }

    return { baseUrl, sid: result.data.sid };
  }

  async logout(session: NasSession): Promise<void> {
    try {
      const url = new URL('/webapi/auth.cgi', session.baseUrl);
      url.searchParams.set('api', 'SYNO.API.Auth');
      url.searchParams.set('version', '6');
      url.searchParams.set('method', 'logout');
      url.searchParams.set('session', 'FileStation');
      await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
    } catch {
      // Ignore logout errors
    }
  }

  async checkStatus(baseUrl: string): Promise<boolean> {
    try {
      const url = new URL('/webapi/query.cgi', baseUrl);
      url.searchParams.set('api', 'SYNO.API.Info');
      url.searchParams.set('version', '1');
      url.searchParams.set('method', 'query');
      const response = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
      const result: SynoResponse = await response.json();
      return result.success;
    } catch {
      return false;
    }
  }

  async checkStatusForCineClub(cineClubId: number): Promise<boolean> {
    const club = await this.prisma.cineClub.findUnique({ where: { id: cineClubId } });
    if (!club?.nasBaseUrl) return false;

    const online = await this.checkStatus(club.nasBaseUrl);
    if (online) {
      await this.prisma.cineClub.update({ where: { id: cineClubId }, data: { lastOnlineAt: new Date() } });
    }
    return online;
  }

  async listFiles(session: NasSession, folderPath: string, offset = 0, limit = 500): Promise<SynoFileInfo[]> {
    const result = await this.request<{ files: SynoFileInfo[]; total: number; offset: number }>(
      session.baseUrl,
      {
        api: 'SYNO.FileStation.List',
        version: '2',
        method: 'list',
        folder_path: folderPath,
        additional: '["size","time","real_path"]',
        offset: String(offset),
        limit: String(limit),
        _sid: session.sid,
      },
    );

    if (!result.success) {
      throw new Error(`Impossible de lister les fichiers : ${JSON.stringify(result.error)}`);
    }

    return result.data?.files || [];
  }

  async listAllVideoFiles(session: NasSession, sharedFolders: string[]): Promise<SynoFileInfo[]> {
    const allFiles: SynoFileInfo[] = [];

    for (const folder of sharedFolders) {
      try {
        const files = await this.listFilesRecursive(session, folder);
        allFiles.push(...files);
      } catch (error) {
        this.logger.warn(`Échec du scan du dossier ${folder} : ${error}`);
      }
    }

    if (allFiles.length > 0) {
      this.logger.log(`[NAS] Exemple de fichier additional : ${JSON.stringify(allFiles[0].additional)}`);
    }

    return allFiles;
  }

  private async listFilesRecursive(session: NasSession, folderPath: string): Promise<SynoFileInfo[]> {
    const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.m4v', '.ts'];
    const allFiles: SynoFileInfo[] = [];
    let offset = 0;
    const limit = 500;

    while (true) {
      const files = await this.listFiles(session, folderPath, offset, limit);
      if (files.length === 0) break;

      for (const file of files) {
        if (file.isdir) {
          const subFiles = await this.listFilesRecursive(session, file.path);
          allFiles.push(...subFiles);
        } else {
          const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
          if (videoExtensions.includes(ext)) {
            allFiles.push(file);
          }
        }
      }

      if (files.length < limit) break;
      offset += limit;
    }

    return allFiles;
  }

  /**
   * Chemins File Station : commencer par le dossier partagé (/video/…), pas par /volume1/video/…
   * (les sync récentes peuvent stocker le chemin « physique » ; l’API Download refuse alors ou renvoie 404 HTML en mode open).
   */
  private normalizeFileStationPath(path: string): string {
    const trimmed = path.trim();
    const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    const stripped = withSlash.replace(/^\/volume\d+\//i, '/');
    if (stripped !== withSlash) {
      this.logger.log(`[FileStation] chemin normalisé (préfixe /volumeN/ retiré) : "${withSlash}" → "${stripped}"`);
    }
    return stripped;
  }

  /**
   * URL FileStation.Download — doc Synology : exemple avec mode=%22open%22 (chaîne JSON).
   * Dupliquer sid + _sid : certains clients / DSM l’exigent (cf. communauté Synology).
   * @param synoOpenOrDownload stream → API mode "open" (MIME selon fichier) ; download → "download" (octet-stream).
   */
  private buildFileStationUrl(baseUrl: string, path: string, sid: string, synoOpenOrDownload: 'stream' | 'download'): string {
    const fsPath = this.normalizeFileStationPath(path);
    const url = new URL('/webapi/entry.cgi', baseUrl);
    url.searchParams.set('api', 'SYNO.FileStation.Download');
    url.searchParams.set('version', '2');
    url.searchParams.set('method', 'download');
    url.searchParams.set('path', JSON.stringify([fsPath]));
    const modeVal = synoOpenOrDownload === 'stream' ? 'open' : 'download';
    url.searchParams.set('mode', JSON.stringify(modeVal));
    url.searchParams.set('_sid', sid);
    url.searchParams.set('sid', sid);
    return url.toString();
  }

  async getStreamUrl(
    mediaId: number,
    userId: number,
    cineClubId: number,
    mode: 'stream' | 'download',
    audioTrack = 1,
    clientType: 'web' | 'tv' = 'web',
  ): Promise<{ nasUrl: string; durationSeconds: number; isHls: boolean; sourceType?: string; jellyfinItemId?: string; jellyfinBaseUrl?: string; jellyfinApiToken?: string }> {
    const [member, media, club, user] = await Promise.all([
      this.prisma.cineClubMember.findUnique({ where: { userId_cineClubId: { userId, cineClubId } } }),
      this.prisma.media.findFirst({ where: { id: mediaId, cineClubId } }),
      this.prisma.cineClub.findUnique({ where: { id: cineClubId } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { streamingQuality: true } }),
    ]);
    const streamingQuality = user?.streamingQuality ?? 'NATIVE';

    if (!media?.nasPath) throw new NotFoundException('Fichier introuvable sur le NAS');
    if (!club) throw new BadRequestException('CineClub introuvable');

    const durationSeconds = (media.runtime ?? 0) * 60;

    // Streaming TV : OBLIGATOIREMENT depuis le NAS (cf. exigence produit).
    // Si le média n'est pas sur le NAS, on refuse explicitement plutôt que de tomber
    // sur Jellyfin (qui ne stream pas HDR/DV de manière fiable côté TV).
    if (mode === 'stream' && clientType === 'tv' && media.sourceType !== 'NAS') {
      throw new BadRequestException(
        'Streaming TV requiert le NAS — ce média doit d\'abord être transféré sur le NAS',
      );
    }

    // ── Source SEEDBOX → Jellyfin ─────────────────────────────────────────────
    if (media.sourceType === 'SEEDBOX') {
      if (!club.jellyfinBaseUrl || !club.jellyfinApiToken) {
        throw new BadRequestException('Jellyfin non configuré pour ce CineClub');
      }
      if (!media.jellyfinItemId) {
        throw new NotFoundException('jellyfinItemId manquant sur ce média');
      }
      if (mode === 'download') {
        const base = club.jellyfinBaseUrl.replace(/\/$/, '');
        const downloadUrl = `${base}/Items/${media.jellyfinItemId}/Download?api_key=${club.jellyfinApiToken}`;
        return { nasUrl: downloadUrl, durationSeconds, isHls: false, sourceType: 'SEEDBOX' };
      }
      // TV: PlaybackInfo → stream HDR10 natif sans Dolby Vision (comme l'app Jellyfin native).
      if (clientType === 'tv') {
        const { url, isHls } = await this.getJellyfinTvStreamUrl(club.jellyfinBaseUrl, club.jellyfinApiToken, media.jellyfinItemId, streamingQuality as 'NATIVE' | 'DIRECT');
        this.logger.log(`[Stream #${mediaId}] Jellyfin TV quality=${streamingQuality} isHls=${isHls} → ${url.slice(0, 80)}…`);
        return { nasUrl: url, durationSeconds, isHls, sourceType: 'SEEDBOX', jellyfinItemId: media.jellyfinItemId, jellyfinBaseUrl: club.jellyfinBaseUrl, jellyfinApiToken: club.jellyfinApiToken };
      }
      // Web: HLS transcode via Jellyfin (navigateurs = codecs limités).
      const url = this.buildJellyfinStreamUrl(club.jellyfinBaseUrl, club.jellyfinApiToken, media.jellyfinItemId, clientType);
      this.logger.log(`[Stream #${mediaId}] Jellyfin passthrough → ${url.slice(0, 80)}…`);
      return { nasUrl: url, durationSeconds, isHls: true, sourceType: 'SEEDBOX', jellyfinItemId: media.jellyfinItemId, jellyfinBaseUrl: club.jellyfinBaseUrl, jellyfinApiToken: club.jellyfinApiToken };
    }
    // ── FIN branchement SEEDBOX ───────────────────────────────────────────────

    if (!member?.nasUsername || !member?.nasPassword) {
      throw new UnauthorizedException('Credentials NAS non configurés pour ce membre');
    }
    if (!club.nasBaseUrl) throw new BadRequestException('NAS non configuré pour ce CineClub');

    // TV: direct play via FileStation (skip VideoStation HLS qui transcode côté Synology).
    // Le controller (passthrough=1) convertira l'URL en /nas/fileproxy pour bypasser le cert auto-signé.
    if (mode === 'stream' && clientType === 'tv') {
      const session = await this.getFileStationSession(club.nasBaseUrl!, member.nasUsername, member.nasPassword);
      this.logger.log(`[Stream #${mediaId}] NAS direct-play (FileStation open)`);
      return {
        nasUrl: this.buildFileStationUrl(club.nasBaseUrl!, media.nasPath, session.sid, 'stream'),
        durationSeconds,
        isHls: false,
        sourceType: 'NAS',
      };
    }

    if (mode === 'stream') {
      try {
        const vsSession = await this.login(club.nasBaseUrl!, member.nasUsername, member.nasPassword, 'VideoStation');
        this.logger.debug(`[Stream #${mediaId}] VideoStation login OK (sid=${vsSession.sid.slice(0, 8)}…)`);

        const { title: pttTitle } = parseMediaFilename(media.nasFilename);
        const titleHints = [pttTitle, media.titleVf, media.titleOriginal].filter(Boolean) as string[];
        this.logger.debug(`[Stream #${mediaId}] nasPath="${media.nasPath}" nasFilename="${media.nasFilename}" pttTitle="${pttTitle}" hints=${JSON.stringify(titleHints)}`);

        const vsVideo = await this.findVideoStationVideo(vsSession, media.nasPath, titleHints, 'movie');
        if (vsVideo) {
          this.logger.debug(`[Stream #${mediaId}] VS video found (id=${vsVideo.videoId} fileId=${vsVideo.fileId}), opening stream…`);
          const hlsUrl = await this.openVideoStationStream(vsSession, vsVideo.videoId, vsVideo.fileId, audioTrack);
          if (hlsUrl) {
            this.logger.log(`[Stream #${mediaId}] VideoStation HLS OK → ${hlsUrl.slice(0, 80)}…`);
            return { nasUrl: hlsUrl, durationSeconds, isHls: true };
          }
          this.logger.warn(`[Stream #${mediaId}] VS video found but stream open returned null`);
        } else {
          this.logger.warn(`[Stream #${mediaId}] No VideoStation match → fallback FFmpeg`);
        }
      } catch (err) {
        this.logger.warn(`[Stream #${mediaId}] VideoStation error → fallback FFmpeg: ${err}`);
      }
    }

    const session = await this.getFileStationSession(club.nasBaseUrl!, member.nasUsername, member.nasPassword);
    const fsMode = mode === 'download' ? 'download' : 'stream';
    return {
      // stream → mode=open (lecture / transcode) ; download → mode=download (fichier brut, cf. getMediaFileUrl)
      nasUrl: this.buildFileStationUrl(club.nasBaseUrl!, media.nasPath, session.sid, fsMode),
      durationSeconds,
      isHls: false,
    };
  }

  async getEpisodeStreamUrl(
    episodeId: number,
    userId: number,
    cineClubId: number,
    mode: 'stream' | 'download',
    audioTrack = 1,
    clientType: 'web' | 'tv' = 'web',
  ): Promise<{ nasUrl: string; durationSeconds: number; isHls: boolean; sourceType?: string; jellyfinItemId?: string; jellyfinBaseUrl?: string; jellyfinApiToken?: string }> {
    const [member, episode, userPref] = await Promise.all([
      this.prisma.cineClubMember.findUnique({ where: { userId_cineClubId: { userId, cineClubId } } }),
      this.prisma.episode.findFirst({
        where: { id: episodeId, season: { media: { cineClubId } } },
        select: { nasPath: true, nasFilename: true, runtime: true, sourceType: true, jellyfinItemId: true, season: { select: { media: { select: { titleVf: true, titleOriginal: true } } } } },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { streamingQuality: true } }),
    ]);
    const streamingQuality = userPref?.streamingQuality ?? 'NATIVE';

    if (!episode) throw new NotFoundException('Épisode introuvable');

    const club = await this.prisma.cineClub.findUnique({ where: { id: cineClubId } });
    if (!club) throw new BadRequestException('CineClub introuvable');

    const durationSeconds = (episode.runtime ?? 0) * 60;

    // Streaming TV : OBLIGATOIREMENT depuis le NAS.
    if (mode === 'stream' && clientType === 'tv' && episode.sourceType !== 'NAS') {
      throw new BadRequestException(
        'Streaming TV requiert le NAS — cet épisode doit d\'abord être transféré sur le NAS',
      );
    }

    // ── Source SEEDBOX → Jellyfin ─────────────────────────────────────────────
    if (episode.sourceType === 'SEEDBOX') {
      if (!club.jellyfinBaseUrl || !club.jellyfinApiToken) {
        throw new BadRequestException('Jellyfin non configuré pour ce CineClub');
      }
      if (!episode.jellyfinItemId) {
        throw new NotFoundException('jellyfinItemId manquant sur cet épisode');
      }
      if (mode === 'download') {
        const base = club.jellyfinBaseUrl.replace(/\/$/, '');
        const downloadUrl = `${base}/Items/${episode.jellyfinItemId}/Download?api_key=${club.jellyfinApiToken}`;
        return { nasUrl: downloadUrl, durationSeconds, isHls: false, sourceType: 'SEEDBOX' };
      }
      // TV: PlaybackInfo → stream HDR10 natif sans Dolby Vision (comme l'app Jellyfin native).
      if (clientType === 'tv') {
        const { url, isHls } = await this.getJellyfinTvStreamUrl(club.jellyfinBaseUrl, club.jellyfinApiToken, episode.jellyfinItemId, streamingQuality as 'NATIVE' | 'DIRECT');
        this.logger.log(`[Stream ep#${episodeId}] Jellyfin TV quality=${streamingQuality} isHls=${isHls} → ${url.slice(0, 80)}…`);
        return { nasUrl: url, durationSeconds, isHls, sourceType: 'SEEDBOX', jellyfinItemId: episode.jellyfinItemId, jellyfinBaseUrl: club.jellyfinBaseUrl, jellyfinApiToken: club.jellyfinApiToken };
      }
      const url = this.buildJellyfinStreamUrl(club.jellyfinBaseUrl, club.jellyfinApiToken, episode.jellyfinItemId, clientType);
      this.logger.log(`[Stream ep#${episodeId}] Jellyfin passthrough → ${url.slice(0, 80)}…`);
      return { nasUrl: url, durationSeconds, isHls: true, sourceType: 'SEEDBOX', jellyfinItemId: episode.jellyfinItemId, jellyfinBaseUrl: club.jellyfinBaseUrl, jellyfinApiToken: club.jellyfinApiToken };
    }
    // ── FIN branchement SEEDBOX ───────────────────────────────────────────────

    if (!member?.nasUsername || !member?.nasPassword) {
      throw new UnauthorizedException('Credentials NAS non configurés pour ce membre');
    }
    if (!episode.nasPath) throw new NotFoundException('Fichier épisode introuvable sur le NAS');
    if (!club.nasBaseUrl) throw new BadRequestException('NAS non configuré pour ce CineClub');

    // TV: direct play via FileStation (skip VideoStation HLS qui transcode côté Synology).
    if (mode === 'stream' && clientType === 'tv') {
      const session = await this.getFileStationSession(club.nasBaseUrl, member.nasUsername, member.nasPassword);
      this.logger.log(`[Stream ep#${episodeId}] NAS direct-play (FileStation open)`);
      return {
        nasUrl: this.buildFileStationUrl(club.nasBaseUrl, episode.nasPath, session.sid, 'stream'),
        durationSeconds,
        isHls: false,
        sourceType: 'NAS',
      };
    }

    if (mode === 'stream') {
      try {
        const vsSession = await this.login(club.nasBaseUrl, member.nasUsername, member.nasPassword, 'VideoStation');
        this.logger.debug(`[Stream ep#${episodeId}] VideoStation login OK (sid=${vsSession.sid.slice(0, 8)}…)`);

        const nasFilename = episode.nasFilename ?? episode.nasPath.split('/').pop() ?? '';
        const { title: pttTitle } = parseMediaFilename(nasFilename);
        const seriesMedia = episode.season?.media;
        const titleHints = [pttTitle, seriesMedia?.titleVf, seriesMedia?.titleOriginal].filter(Boolean) as string[];
        this.logger.debug(`[Stream ep#${episodeId}] nasPath="${episode.nasPath}" nasFilename="${nasFilename}" pttTitle="${pttTitle}" hints=${JSON.stringify(titleHints)}`);

        const vsVideo = await this.findVideoStationVideo(vsSession, episode.nasPath, titleHints, 'episode');
        if (vsVideo) {
          this.logger.debug(`[Stream ep#${episodeId}] VS video found (id=${vsVideo.videoId} fileId=${vsVideo.fileId}), opening stream…`);
          const hlsUrl = await this.openVideoStationStream(vsSession, vsVideo.videoId, vsVideo.fileId, audioTrack);
          if (hlsUrl) {
            this.logger.log(`[Stream ep#${episodeId}] VideoStation HLS OK → ${hlsUrl.slice(0, 80)}…`);
            return { nasUrl: hlsUrl, durationSeconds, isHls: true };
          }
          this.logger.warn(`[Stream ep#${episodeId}] VS video found but stream open returned null`);
        } else {
          this.logger.warn(`[Stream ep#${episodeId}] No VideoStation match → fallback FFmpeg`);
        }
      } catch (err) {
        this.logger.warn(`[Stream ep#${episodeId}] VideoStation error → fallback FFmpeg: ${err}`);
      }
    }

    const session = await this.getFileStationSession(club.nasBaseUrl, member.nasUsername, member.nasPassword);
    const fsMode = mode === 'download' ? 'download' : 'stream';
    return {
      nasUrl: this.buildFileStationUrl(club.nasBaseUrl, episode.nasPath, session.sid, fsMode),
      durationSeconds,
      isHls: false,
    };
  }

  // ── Wake-on-LAN ────────────────────────────────────────────────────────────

  async sendWakeOnLan(cineClubId: number, startedByUserId?: number): Promise<{ alreadyInProgress: boolean }> {
    const club = await this.prisma.cineClub.findUnique({ where: { id: cineClubId } });
    if (!club?.nasWolMac) throw new BadRequestException('Adresse MAC WoL non configurée pour ce CineClub');

    const mac = club.nasWolMac.replace(/[:\-\s]/g, '');
    if (mac.length !== 12) throw new BadRequestException('Adresse MAC invalide (format attendu: XX:XX:XX:XX:XX:XX)');

    // Idempotence : si un wake est déjà en cours et n'a pas expiré, on ne renvoie pas de nouveau magic packet.
    const timeoutMs = (club.nasWolWaitSeconds || 300) * 1000;
    if (club.nasWakeInProgress && club.nasWakeStartedAt) {
      const elapsed = Date.now() - club.nasWakeStartedAt.getTime();
      if (elapsed < timeoutMs) {
        this.logger.log(`[WoL] Démarrage déjà en cours pour cineClub#${cineClubId} (élapsed ${Math.round(elapsed / 1000)}s)`);
        return { alreadyInProgress: true };
      }
    }

    // Marquer le wake comme en cours AVANT d'envoyer le packet.
    await this.prisma.cineClub.update({
      where: { id: cineClubId },
      data: {
        nasWakeInProgress: true,
        nasWakeStartedAt: new Date(),
        nasWakeStartedByUserId: startedByUserId ?? null,
      },
    });
    this.nasGateway.emitNasWakeStarted(cineClubId, startedByUserId ?? null);

    try {
      // Méthode préférée : API Freebox (fiable depuis internet)
      if (club.freeboxApiUrl && club.freeboxAppToken) {
        const appToken = this.decryptToken(club.freeboxAppToken);
        await this.sendWakeOnLanViaFreebox(club.freeboxApiUrl, appToken, club.nasWolMac);
        this.logger.log(`[WoL] Magic packet envoyé via Freebox API (MAC: ${club.nasWolMac})`);
      } else {
        // Fallback : UDP direct (nécessite port-forward broadcast côté routeur)
        if (!club.nasWolHost) throw new BadRequestException('Hôte WoL non configuré pour ce CineClub');

        const macBytes = mac.match(/.{2}/g)!.map((h) => parseInt(h, 16));
        const packet = Buffer.alloc(102);
        for (let i = 0; i < 6; i++) packet[i] = 0xff;
        for (let i = 1; i <= 16; i++) macBytes.forEach((b, j) => { packet[i * 6 + j] = b; });

        let address: string;
        try {
          const resolved = await lookup(club.nasWolHost);
          address = resolved.address;
        } catch {
          address = club.nasWolHost;
        }
        const port = club.nasWolPort ?? 9;

        await new Promise<void>((resolve, reject) => {
          const socket = createSocket('udp4');
          socket.once('error', (err) => { socket.close(); reject(err); });
          socket.bind(() => {
            socket.setBroadcast(true);
            socket.send(packet, port, address, (err) => {
              socket.close();
              if (err) reject(err); else resolve();
            });
          });
        });

        this.logger.log(`[WoL] Magic packet envoyé (UDP) → ${address}:${port} (MAC: ${club.nasWolMac})`);
      }
    } catch (err) {
      // Rollback du flag si l'envoi du packet a échoué
      await this.prisma.cineClub.update({
        where: { id: cineClubId },
        data: { nasWakeInProgress: false, nasWakeStartedAt: null, nasWakeStartedByUserId: null },
      });
      this.nasGateway.emitNasWakeFailed(cineClubId, err instanceof Error ? err.message : String(err));
      throw err;
    }

    // Démarre le poll asynchrone (non bloquant) qui détecte le NAS en ligne ou expire après nasWolWaitSeconds.
    this.startWakePoll(cineClubId, timeoutMs);

    return { alreadyInProgress: false };
  }

  private startWakePoll(cineClubId: number, timeoutMs: number) {
    const startedAt = Date.now();
    const intervalMs = 5000;
    const tick = async () => {
      try {
        const club = await this.prisma.cineClub.findUnique({
          where: { id: cineClubId },
          select: { nasBaseUrl: true, nasWakeInProgress: true },
        });
        if (!club?.nasWakeInProgress) return; // déjà cleared par ailleurs

        if (club.nasBaseUrl) {
          const online = await this.checkStatus(club.nasBaseUrl);
          if (online) {
            await this.prisma.cineClub.update({
              where: { id: cineClubId },
              data: { nasWakeInProgress: false, nasWakeStartedAt: null, nasWakeStartedByUserId: null, lastOnlineAt: new Date() },
            });
            this.nasGateway.emitNasOnline(cineClubId);
            this.logger.log(`[WoL] NAS cineClub#${cineClubId} en ligne après ${Math.round((Date.now() - startedAt) / 1000)}s`);
            return;
          }
        }

        if (Date.now() - startedAt > timeoutMs) {
          await this.prisma.cineClub.update({
            where: { id: cineClubId },
            data: { nasWakeInProgress: false, nasWakeStartedAt: null, nasWakeStartedByUserId: null },
          });
          this.nasGateway.emitNasWakeFailed(cineClubId, 'Timeout — aucune réponse du NAS');
          this.logger.warn(`[WoL] Timeout wake cineClub#${cineClubId} après ${Math.round(timeoutMs / 1000)}s`);
          return;
        }

        setTimeout(tick, intervalMs);
      } catch (err) {
        this.logger.error(`[WoL poll] ${err}`);
      }
    };
    setTimeout(tick, intervalMs);
  }

  private async sendWakeOnLanViaFreebox(freeboxApiUrl: string, appToken: string, mac: string): Promise<void> {
    const base = freeboxApiUrl.replace(/\/$/, '');

    // 1. Récupérer le challenge
    const loginRes = await fetchInsecure(`${base}/api/v8/login/`);
    const loginData = await loginRes.json() as { success: boolean; result: { challenge: string } };
    if (!loginData.success) throw new Error('Freebox login: échec récupération challenge');

    // 2. HMAC-SHA1(app_token, challenge)
    const password = createHmac('sha1', appToken).update(loginData.result.challenge).digest('hex');

    // 3. Ouvrir une session
    const sessionRes = await fetchInsecure(`${base}/api/v8/login/session/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: 'nasflix', password }),
    });
    const sessionData = await sessionRes.json() as { success: boolean; msg?: string; error_code?: string; result: { session_token: string } };
    if (!sessionData.success) throw new Error(`Freebox login: échec ouverture session (${sessionData.error_code ?? sessionData.msg ?? JSON.stringify(sessionData)})`);

    const sessionToken = sessionData.result.session_token;

    try {
      // 4. Envoyer WoL via l'interface pub (LAN)
      const wolRes = await fetchInsecure(`${base}/api/v8/lan/wol/pub/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Fbx-App-Auth': sessionToken },
        body: JSON.stringify({ mac }),
      });
      const wolData = await wolRes.json() as { success: boolean; msg?: string };
      if (!wolData.success) throw new Error(`Freebox WoL: ${wolData.msg ?? 'échec'}`);
    } finally {
      // 5. Fermer la session
      await fetchInsecure(`${base}/api/v8/logout/`, {
        method: 'POST',
        headers: { 'X-Fbx-App-Auth': sessionToken },
      }).catch(() => {});
    }
  }

  async saveFreeboxConfig(cineClubId: number, freeboxApiUrl: string, appToken: string): Promise<void> {
    const encrypted = this.encryptToken(appToken.replace(/\\\//g, '/'));
    await this.prisma.cineClub.update({
      where: { id: cineClubId },
      data: { freeboxApiUrl, freeboxAppToken: encrypted },
    });
  }

  // ── Freebox authorization flow ─────────────────────────────────────────────

  async startFreeboxAuthorization(cineClubId: number, freeboxApiUrl: string): Promise<{ trackId: number; appToken: string }> {
    const base = freeboxApiUrl.replace(/\/$/, '');
    const res = await fetchInsecure(`${base}/api/v8/login/authorize/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: 'nasflix',
        app_name: 'Nasflix',
        app_version: '1.0.0',
        device_name: 'Railway',
      }),
    });
    const data = await res.json() as { success: boolean; result?: { app_token: string; track_id: number }; msg?: string };
    if (!data.success || !data.result) throw new BadRequestException(`Freebox authorize: ${data.msg ?? 'échec'}`);

    // Sauvegarder l'URL et le token en attente de validation
    const encrypted = this.encryptToken(data.result.app_token);
    await this.prisma.cineClub.update({
      where: { id: cineClubId },
      data: { freeboxApiUrl, freeboxAppToken: encrypted },
    });

    return { trackId: data.result.track_id, appToken: data.result.app_token };
  }

  async checkFreeboxAuthorizationStatus(cineClubId: number, trackId: number): Promise<{ status: string; granted: boolean }> {
    const club = await this.prisma.cineClub.findUnique({ where: { id: cineClubId } });
    if (!club?.freeboxApiUrl) throw new BadRequestException('freeboxApiUrl non configurée');

    const base = club.freeboxApiUrl.replace(/\/$/, '');
    const res = await fetchInsecure(`${base}/api/v8/login/authorize/${trackId}`);
    const data = await res.json() as { success: boolean; result?: { status: string }; msg?: string };
    if (!data.success || !data.result) throw new BadRequestException(`Freebox authorize check: ${data.msg ?? 'échec'}`);

    return { status: data.result.status, granted: data.result.status === 'granted' };
  }

  // ── Chiffrement AES-256-GCM ────────────────────────────────────────────────

  private getEncryptionKey(): Buffer {
    const hex = this.config.get<string>('FREEBOX_ENCRYPTION_KEY');
    if (!hex) throw new BadRequestException('FREEBOX_ENCRYPTION_KEY non configurée dans les variables d\'env');
    const key = Buffer.from(hex, 'hex');
    if (key.length !== 32) throw new BadRequestException('FREEBOX_ENCRYPTION_KEY doit être 32 bytes (64 caractères hex)');
    return key;
  }

  private encryptToken(plaintext: string): string {
    const key = this.getEncryptionKey();
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  private decryptToken(ciphertext: string): string {
    const key = this.getEncryptionKey();
    const parts = ciphertext.split(':');
    if (parts.length !== 3) throw new Error('Format de token chiffré invalide');
    const [ivHex, tagHex, encHex] = parts;
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
  }

  // ── VideoStation ──────────────────────────────────────────────────────────

  private async findVideoStationVideo(
    session: NasSession,
    nasPath: string,
    titleHints: string[],
    mediaType: 'movie' | 'episode',
  ): Promise<{ videoId: number; fileId?: string } | null> {
    if (mediaType === 'movie') {
      return this.findVsMovie(session, nasPath, titleHints);
    }
    return this.findVsEpisode(session, nasPath);
  }

  /**
   * Movie search: keyword-based via SYNO.VideoStation2.Movie (DSM 7+)
   * then SYNO.VideoStation.Movie (DSM 6).
   * Tries each title hint until a result is found.
   */
  private async findVsMovie(
    session: NasSession,
    nasPath: string,
    titleHints: string[],
  ): Promise<{ videoId: number; fileId?: string } | null> {
    type VSMovie = { id: number; mapper_id?: number; title?: string; file?: VideoStationFile[] };

    const movieApis = ['SYNO.VideoStation2.Movie'];

    for (const api of movieApis) {
      for (const keyword of titleHints) {
        try {
          this.logger.debug(`[VideoStation] ${api} keyword="${keyword}"…`);
          const result = await this.request<{ total: number; movie?: VSMovie[] }>(
            session.baseUrl,
            { api, version: '1', method: 'list', library_id: '0', keyword, offset: '0', limit: '10', _sid: session.sid },
          );

          if (!result.success) {
            this.logger.debug(`[VideoStation] ${api} error=${JSON.stringify(result.error)} — skipping API`);
            break;
          }

          const movies = result.data?.movie ?? [];
          this.logger.debug(`[VideoStation] ${api} keyword="${keyword}" → ${movies.length} résultat(s)`);

          if (movies.length === 0) continue;

          const pickMovie = (movie: VSMovie) => {
            // mapper_id est l'identifiant du fichier utilisé par SYNO.VideoStation2.Streaming
            const fileId = movie.mapper_id != null ? String(movie.mapper_id) : movie.file?.[0]?.id;
            this.logger.debug(`[VideoStation] movie.id=${movie.id} mapper_id=${movie.mapper_id} file[0]=${JSON.stringify(movie.file?.[0])} → fileId=${fileId}`);
            return { videoId: movie.id, fileId };
          };

          // Correspondance par chemin (le plus fiable)
          for (const movie of movies) {
            if ((movie.file ?? []).some((f) => f.path === nasPath)) {
              this.logger.log(`[VideoStation] ✅ Film trouvé par chemin: "${movie.title}" (id=${movie.id})`);
              return pickMovie(movie);
            }
          }

          // Un seul résultat → on fait confiance au keyword
          if (movies.length === 1) {
            this.logger.log(`[VideoStation] ✅ Film trouvé par keyword (résultat unique): "${movies[0].title}" (id=${movies[0].id})`);
            return pickMovie(movies[0]);
          }

          this.logger.debug(`[VideoStation] ${movies.length} résultats pour "${keyword}", aucun avec ce chemin: ${movies.map((m) => `"${m.title}"`).join(', ')}`);
        } catch (err) {
          this.logger.debug(`[VideoStation] ${api} search exception: ${err}`);
          break;
        }
      }
    }

    this.logger.debug(`[VideoStation] Aucun film trouvé pour nasPath="${nasPath}"`);
    return null;
  }

  /**
   * Episode search: path-based via SYNO.VideoStation2.TVShowEpisode (DSM 7+)
   * then SYNO.VideoStation.TVShowEpisode (DSM 6).
   */
  private async findVsEpisode(
    session: NasSession,
    nasPath: string,
  ): Promise<{ videoId: number; fileId?: string } | null> {
    type VSEpisode = { id: number; title?: string; file?: VideoStationFile[] };

    const episodeApis = ['SYNO.VideoStation2.TVShowEpisode'];

    for (const api of episodeApis) {
      try {
        this.logger.debug(`[VideoStation] ${api} list (recherche par chemin)… nasPath="${nasPath}"`);
        const result = await this.request<{ total: number; episode?: VSEpisode[] }>(
          session.baseUrl,
          { api, version: '1', method: 'list', offset: '0', limit: '5000', additional: '["file"]', _sid: session.sid },
        );

        if (!result.success) {
          this.logger.debug(`[VideoStation] ${api} error=${JSON.stringify(result.error)}`);
          continue;
        }

        const episodes = result.data?.episode ?? [];
        this.logger.debug(`[VideoStation] ${api} → ${episodes.length} épisode(s)`);

        for (const ep of episodes) {
          if ((ep.file ?? []).some((f) => f.path === nasPath)) {
            const fileId = ep.file?.[0]?.id;
            this.logger.log(`[VideoStation] ✅ Épisode trouvé par chemin: "${ep.title}" (id=${ep.id}) fileId=${fileId}`);
            return { videoId: ep.id, fileId };
          }
        }

        const samplePaths = episodes.flatMap((e) => (e.file ?? []).map((f) => f.path)).slice(0, 5);
        this.logger.debug(`[VideoStation] Aucun épisode correspondant. Exemples de chemins VS: ${JSON.stringify(samplePaths)}`);
        return null;
      } catch (err) {
        this.logger.debug(`[VideoStation] ${api} exception: ${err}`);
      }
    }

    return null;
  }

  private async openVideoStationStream(
    session: NasSession,
    videoId: number,
    fileId?: string,
    audioTrack = 1,
  ): Promise<string | null> {
    // Essayer différentes combinaisons de paramètres pour VideoStation2 vs VideoStation1
    // VS2 (DSM 7+) attend `file=<fileId>`, VS1 attend `id=<videoId>`
    const fidNum = fileId != null ? Number(fileId) : videoId;

    // Format exact découvert via DevTools VideoStation :
    // file={"id":<mapper_id>}, hls_remux={"hls_header":true,"audio_track":1}, pin="", version=2
    // Essayer d'abord hls_remux (pas de ré-encodage), puis transcode (compatible plus de formats)
    const variants: Array<{ label: string; body: Record<string, unknown> }> = [
      // VS 3.x (DSM 7.2+) — fileId direct + version 3
      { label: 'v3_hls_remux', body: { api: 'SYNO.VideoStation2.Streaming', version: 3, method: 'open', fileId: fidNum, pin: '', hls_remux: { hls_header: true, audio_track: audioTrack } } },
      { label: 'v3_transcode', body: { api: 'SYNO.VideoStation2.Streaming', version: 3, method: 'open', fileId: fidNum, pin: '', transcode: { video_codec: 'h264', audio_codec: 'aac' } } },
      // VS 2.x (DSM 7.0-7.1) — file:{id} + version 2
      { label: 'v2_hls_remux', body: { api: 'SYNO.VideoStation2.Streaming', version: 2, method: 'open', file: { id: fidNum }, pin: '', hls_remux: { hls_header: true, audio_track: audioTrack } } },
      { label: 'v2_transcode', body: { api: 'SYNO.VideoStation2.Streaming', version: 2, method: 'open', file: { id: fidNum }, pin: '', transcode: { video_codec: 'h264', audio_codec: 'aac' } } },
      { label: 'v2_bare',     body: { api: 'SYNO.VideoStation2.Streaming', version: 2, method: 'open', file: { id: fidNum }, pin: '' } },
    ];

    for (const { label, body } of variants) {
      const extra = body;
      this.logger.debug(`[VideoStation] POST Streaming [${label}] fileId=${fidNum}`);
      try {
        const result = await this.requestFormPost<{ playlist_url?: string }>(session.baseUrl, session.sid, extra);
        if (result.success && result.data?.playlist_url) {
          let url = result.data.playlist_url;
          if (url.startsWith('/')) url = `${session.baseUrl.replace(/\/$/, '')}${url}`;
          this.logger.log(`[VideoStation] ✅ Stream ouvert [${label}] → ${url.slice(0, 80)}…`);
          return url;
        }
        this.logger.debug(`[VideoStation] [${label}]: success=${result.success} error=${JSON.stringify(result.error)}`);
      } catch (err) {
        this.logger.debug(`[VideoStation] [${label}] exception: ${err}`);
      }
    }

    return null;
  }

  async getMediaDuration(mediaId: number, cineClubId: number): Promise<number> {
    const media = await this.prisma.media.findFirst({ where: { id: mediaId, cineClubId }, select: { runtime: true } });
    return (media?.runtime ?? 0) * 60;
  }

  async getEpisodeDuration(episodeId: number, cineClubId: number): Promise<number> {
    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, season: { media: { cineClubId } } },
      select: { runtime: true },
    });
    return (episode?.runtime ?? 0) * 60;
  }

  // ── Track probing ──────────────────────────────────────────────────────────

  async getMediaFileUrl(mediaId: number, userId: number, cineClubId: number): Promise<string> {
    const [member, media, club] = await Promise.all([
      this.prisma.cineClubMember.findUnique({ where: { userId_cineClubId: { userId, cineClubId } } }),
      this.prisma.media.findFirst({ where: { id: mediaId, cineClubId } }),
      this.prisma.cineClub.findUnique({ where: { id: cineClubId } }),
    ]);
    if (!member?.nasUsername || !member?.nasPassword) throw new UnauthorizedException('Credentials NAS non configurés');
    if (!media?.nasPath) throw new NotFoundException('Fichier introuvable sur le NAS');
    if (!club?.nasBaseUrl) throw new BadRequestException('NAS non configuré');
    const session = await this.getFileStationSession(club.nasBaseUrl, member.nasUsername, member.nasPassword);
    // Mode API "download" : évite la page HTML 404 que DSM renvoie pour toute erreur en mode "open" (doc § Download).
    return this.buildFileStationUrl(club.nasBaseUrl, media.nasPath, session.sid, 'download');
  }

  async getEpisodeFileUrl(episodeId: number, userId: number, cineClubId: number): Promise<string> {
    const [member, episode] = await Promise.all([
      this.prisma.cineClubMember.findUnique({ where: { userId_cineClubId: { userId, cineClubId } } }),
      this.prisma.episode.findFirst({
        where: { id: episodeId, season: { media: { cineClubId } } },
        select: { nasPath: true },
      }),
    ]);
    if (!member?.nasUsername || !member?.nasPassword) throw new UnauthorizedException('Credentials NAS non configurés');
    if (!episode?.nasPath) throw new NotFoundException('Fichier épisode introuvable sur le NAS');
    const club = await this.prisma.cineClub.findUnique({ where: { id: cineClubId } });
    if (!club?.nasBaseUrl) throw new BadRequestException('NAS non configuré');
    const session = await this.getFileStationSession(club.nasBaseUrl, member.nasUsername, member.nasPassword);
    return this.buildFileStationUrl(club.nasBaseUrl, episode.nasPath, session.sid, 'download');
  }

  /**
   * Ouvre un flux de lecture HTTP(S) vers le NAS (cert auto-signé toléré) destiné à être
   * pipé dans stdin de FFmpeg. Indispensable : le build Linux de ffmpeg-static (Railway)
   * ne connaît pas l'option -tls_verify et échoue à ouvrir lui-même l'URL https du NAS —
   * en dev macOS le build accepte le flag, d'où un bug invisible en local.
   */
  private openNasFileStream(nasFileUrl: string, timeoutMs: number): Promise<import('node:http').IncomingMessage> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(nasFileUrl);
      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;
      const req = lib.request({
        hostname: parsed.hostname,
        port: Number(parsed.port) || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Nasflix/1.0)', Accept: '*/*' },
        rejectUnauthorized: false,
        timeout: timeoutMs,
      }, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300) {
          res.resume();
          reject(new Error(`NAS a répondu ${status} (SID expiré ?) sur ${parsed.hostname}`));
          return;
        }
        resolve(res);
      });
      req.on('timeout', () => req.destroy(new Error(`Timeout connexion NAS (${timeoutMs}ms)`)));
      req.on('error', reject);
      req.end();
    });
  }

  async probeMediaTracks(nasFileUrl: string): Promise<MediaTracks> {
    // Lecture du début du fichier via Node pipée dans stdin (cf. openNasFileStream) ;
    // FFmpeg n'analyse que quelques Mo avant d'afficher les pistes puis ferme stdin.
    let nasRes: import('node:http').IncomingMessage;
    try {
      nasRes = await this.openNasFileStream(nasFileUrl, 10_000);
    } catch (err) {
      this.logger.warn(`[probe] ouverture flux NAS échouée : ${err}`);
      return { audio: [], subtitles: [] };
    }

    return new Promise((resolve) => {
      // ffmpeg -i sans sortie : affiche les infos de streams sur stderr puis sort en erreur
      const proc = spawn(ffmpegPath, ['-i', 'pipe:0'], { stdio: ['pipe', 'ignore', 'pipe'] });

      let stderr = '';
      proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      // EPIPE attendu : ffmpeg ferme stdin dès l'analyse terminée
      proc.stdin?.on('error', () => {});
      nasRes.on('error', () => {});
      nasRes.pipe(proc.stdin!);

      const kill = setTimeout(() => proc.kill('SIGKILL'), 15_000);
      proc.on('close', () => {
        clearTimeout(kill);
        nasRes.destroy();
        const tracks = this.parseFfmpegStreamInfo(stderr);
        if (tracks.audio.length === 0 && tracks.subtitles.length === 0) {
          this.logger.warn(`[probe] aucune piste détectée — fin stderr FFmpeg : ${stderr.slice(-600).replace(/\s+/g, ' ')}`);
        }
        resolve(tracks);
      });
      proc.on('error', () => { clearTimeout(kill); nasRes.destroy(); resolve({ audio: [], subtitles: [] }); });
    });
  }

  private parseFfmpegStreamInfo(stderr: string): MediaTracks {
    const audio: AudioTrackInfo[] = [];
    const subtitles: SubtitleTrackInfo[] = [];
    let audioIdx = 0;
    let subIdx = 0;

    for (const line of stderr.split('\n')) {
      const aMatch = line.match(/Stream #\d+:\d+(?:\((\w+)\))?(?:,\s*\w+)?: Audio: (\w+)(.*)/);
      if (aMatch) {
        const lang = aMatch[1] || 'und';
        const rest = aMatch[3];
        const channels = this.parseChannels(rest);
        audio.push({ index: audioIdx++, language: lang, title: this.langLabel(lang), codec: aMatch[2].toUpperCase(), channels });
      }

      const sMatch = line.match(/Stream #\d+:\d+(?:\((\w+)\))?(?:,\s*\w+)?: Subtitle: (\w+)/);
      if (sMatch) {
        const lang = sMatch[1] || 'und';
        subtitles.push({ index: subIdx++, language: lang, title: this.langLabel(lang), codec: sMatch[2].toUpperCase() });
      }
    }

    return { audio, subtitles };
  }

  private parseChannels(rest: string): number {
    if (/\b7\.1\b/.test(rest)) return 8;
    if (/\b5\.1\b/.test(rest)) return 6;
    if (/\b2\.1\b/.test(rest)) return 3;
    if (/\bstereo\b/i.test(rest)) return 2;
    if (/\bmono\b/i.test(rest)) return 1;
    const m = rest.match(/(\d+) channels/);
    return m ? parseInt(m[1]) : 2;
  }

  private langLabel(code: string): string {
    const map: Record<string, string> = {
      fra: 'Français', fre: 'Français', fr: 'Français',
      eng: 'English', en: 'English',
      deu: 'Deutsch', ger: 'Deutsch', de: 'Deutsch',
      spa: 'Español', es: 'Español',
      ita: 'Italiano', it: 'Italiano',
      jpn: '日本語', ja: '日本語',
      kor: '한국어', ko: '한국어',
      por: 'Português', pt: 'Português',
      und: 'Indéfini',
    };
    return map[code.toLowerCase()] || code.toUpperCase();
  }

  // ── Jellyfin / Seedbox ────────────────────────────────────────────────────────

  private buildJellyfinStreamUrl(
    jellyfinBaseUrl: string,
    jellyfinApiToken: string,
    jellyfinItemId: string,
    clientType: 'web' | 'tv' = 'web',
  ): string {
    const base = jellyfinBaseUrl.replace(/\/$/, '');
    // PlaySessionId: client-generated UUID required by Jellyfin to track the HLS session.
    // MediaSourceId: equals the item ID for single-file items (Jellyfin returns it via PlaybackInfo too).
    // Web-only: TV utilise buildJellyfinDirectStreamUrl (direct play sans transcode).
    const params = new URLSearchParams({
      api_key: jellyfinApiToken,
      DeviceId: `nasflix-${clientType}`,
      MediaSourceId: jellyfinItemId,
      PlaySessionId: randomUUID(),
      Container: 'ts',
      TranscodingContainer: 'ts',
      SegmentContainer: 'ts',
      MinSegments: '1',
      static: 'false',
      // Web: transcode HEVC → H.264 (browsers can't decode HEVC/Dolby), high bitrate for 4K quality
      VideoCodec: 'h264,hevc,vp9',
      AudioCodec: 'aac',
      AllowVideoStreamCopy: 'true',
      AllowAudioStreamCopy: 'false',
      MaxStreamingBitrate: '120000000',
    });
    return `${base}/Videos/${jellyfinItemId}/master.m3u8?${params.toString()}`;
  }

  /**
   * Interroge l'API PlaybackInfo de Jellyfin avec un device profile sans codecs Dolby Vision.
   * Jellyfin répond alors avec la couche HDR10 compatible pour les fichiers DV Profile 8,
   * exactement comme l'app native Jellyfin TV.
   *
   * Retourne le meilleur stream disponible :
   *   - Direct Play  → Static=true (fichier brut, isHls=false)
   *   - Direct Stream → HLS fMP4 sans ré-encodage (isHls=true, TV se connecte directement)
   *   - Fallback      → Static=true si l'API est injoignable
   */
  private async getJellyfinTvStreamUrl(
    jellyfinBaseUrl: string,
    jellyfinApiToken: string,
    jellyfinItemId: string,
    streamingQuality: 'NATIVE' | 'DIRECT' = 'NATIVE',
  ): Promise<{ url: string; isHls: boolean }> {
    const base = jellyfinBaseUrl.replace(/\/$/, '');
    const deviceId = 'nasflix-tv';

    const staticFallback = (): { url: string; isHls: boolean } => {
      const p = new URLSearchParams({
        api_key: jellyfinApiToken, Static: 'true',
        DeviceId: deviceId, MediaSourceId: jellyfinItemId,
        PlaySessionId: randomUUID(),
      });
      return { url: `${base}/Videos/${jellyfinItemId}/stream?${p}`, isHls: false };
    };

    // Un API key serveur Jellyfin n'a pas de "moi" → /Users/Me retourne 400.
    // On liste tous les utilisateurs et on prend l'admin (ou le premier).
    let userId: string;
    try {
      const r = await fetch(`${base}/Users?api_key=${jellyfinApiToken}`, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const users = await r.json() as Array<{ Id: string; Policy?: { IsAdministrator?: boolean } }>;
      if (!users.length) throw new Error('No users');
      userId = (users.find(u => u.Policy?.IsAdministrator) ?? users[0]).Id;
    } catch (e) {
      this.logger.warn(`[jellyfin-tv] /Users failed: ${e} — Static fallback`);
      return staticFallback();
    }

    // NATIVE : DirectPlayProfiles vide → force HLS, Jellyfin ne sert jamais le fichier DV brut.
    // DIRECT : DirectPlayProfiles complet → Jellyfin sert le fichier tel quel (DV visible sur TV).
    const deviceProfile = streamingQuality === 'DIRECT'
      ? {
          MaxStreamingBitrate: 200_000_000,
          DirectPlayProfiles: [{
            Container: 'mp4,m4v,mkv,mov,ts,avi',
            Type: 'Video',
            VideoCodec: 'h264,hevc,dvhe,dvh1,vp9,av1',
            AudioCodec: 'aac,ac3,eac3,truehd,dts,flac,mp3,opus,alac',
          }],
          TranscodingProfiles: [{
            Container: 'mp4', Type: 'Video', Protocol: 'hls',
            VideoCodec: 'hevc,h264,dvhe,dvh1', AudioCodec: 'aac,ac3,eac3',
            Context: 'Streaming', MinSegments: 1, BreakOnNonKeyFrames: true,
          }],
          SubtitleProfiles: [{ Format: 'srt', Method: 'External' }, { Format: 'vtt', Method: 'External' }],
        }
      : {
          MaxStreamingBitrate: 200_000_000,
          DirectPlayProfiles: [],
          TranscodingProfiles: [{
            Container: 'mp4', Type: 'Video', Protocol: 'hls',
            VideoCodec: 'hevc,h264,dvhe,dvh1,vp9,av1',
            AudioCodec: 'aac,ac3,eac3,truehd,dts,flac,mp3,opus,alac',
            Context: 'Streaming', MinSegments: 1, BreakOnNonKeyFrames: true,
          }],
          SubtitleProfiles: [{ Format: 'srt', Method: 'External' }, { Format: 'vtt', Method: 'External' }],
        };

    type JfSource = {
      Id?: string;
      SupportsDirectPlay?: boolean;
      SupportsDirectStream?: boolean;
      TranscodingUrl?: string;
      TranscodingSubProtocol?: string;
    };
    let source: JfSource | undefined;
    try {
      const r = await fetch(
        `${base}/Items/${jellyfinItemId}/PlaybackInfo?userId=${userId}&DeviceId=${deviceId}&api_key=${jellyfinApiToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ DeviceProfile: deviceProfile, UserId: userId }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      source = (await r.json() as { MediaSources?: JfSource[] }).MediaSources?.[0];
    } catch (e) {
      this.logger.warn(`[jellyfin-tv] PlaybackInfo failed: ${e} — Static fallback`);
      return staticFallback();
    }

    if (!source) {
      this.logger.warn(`[jellyfin-tv] PlaybackInfo: no MediaSources — Static fallback`);
      return staticFallback();
    }

    // Direct Play : le fichier peut être servi tel quel (HEVC HDR10, pas de DV selon Jellyfin)
    if (source.SupportsDirectPlay) {
      const p = new URLSearchParams({
        api_key: jellyfinApiToken, Static: 'true',
        DeviceId: deviceId, MediaSourceId: source.Id ?? jellyfinItemId,
        PlaySessionId: randomUUID(),
      });
      this.logger.log(`[jellyfin-tv] Direct Play → ${jellyfinItemId}`);
      return { url: `${base}/Videos/${jellyfinItemId}/stream?${p}`, isHls: false };
    }

    // Direct Stream ou Transcode : URL HLS calculée par Jellyfin
    if (source.TranscodingUrl) {
      const isHls = (source.TranscodingSubProtocol ?? '').toLowerCase() === 'hls';
      const url = source.TranscodingUrl.startsWith('http') ? source.TranscodingUrl : `${base}${source.TranscodingUrl}`;
      this.logger.log(`[jellyfin-tv] ${source.SupportsDirectStream ? 'DirectStream' : 'Transcode'} isHls=${isHls} → ${url.slice(0, 80)}…`);
      return { url, isHls };
    }

    this.logger.warn(`[jellyfin-tv] PlaybackInfo: no usable URL — Static fallback`);
    return staticFallback();
  }

  async getJellyfinPlaybackInfo(
    jellyfinBaseUrl: string,
    jellyfinApiToken: string,
    jellyfinItemId: string,
  ): Promise<MediaTracks> {
    const base = jellyfinBaseUrl.replace(/\/$/, '');
    const url = `${base}/Items/${jellyfinItemId}/PlaybackInfo?api_key=${jellyfinApiToken}`;
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    } catch (err) {
      // Timeout undici / seedbox injoignable → tracks vides, ne casse pas la lecture.
      this.logger.warn(`[jellyfin-playbackinfo] fetch ${jellyfinItemId} failed: ${(err as Error).message}`);
      return { audio: [], subtitles: [] };
    }
    if (!res.ok) return { audio: [], subtitles: [] };

    const data = await res.json() as {
      MediaSources?: Array<{
        MediaStreams?: Array<{
          Type: string;
          Index: number;
          Language?: string;
          DisplayTitle?: string;
          Codec?: string;
          Channels?: number;
          IsDefault?: boolean;
        }>;
      }>;
    };

    const streams = data.MediaSources?.[0]?.MediaStreams ?? [];

    const audio: AudioTrackInfo[] = streams
      .filter(s => s.Type === 'Audio')
      .map((s, i) => ({
        index: i,
        language: s.Language || 'und',
        title: s.DisplayTitle || s.Language || `Piste ${i + 1}`,
        codec: s.Codec?.toUpperCase() || '',
        channels: s.Channels || 2,
      }));

    const subtitles: SubtitleTrackInfo[] = streams
      .filter(s => s.Type === 'Subtitle')
      .map((s, i) => ({
        index: i,
        language: s.Language || 'und',
        title: s.DisplayTitle || s.Language || `Sous-titre ${i + 1}`,
        codec: s.Codec?.toUpperCase() || '',
        jellyfinIndex: typeof s.Index === 'number' ? s.Index : undefined,
      }));

    return { audio, subtitles };
  }

  async getJellyfinItems(
    jellyfinBaseUrl: string,
    jellyfinApiToken: string,
    mediaType: 'Movie' | 'Episode',
  ): Promise<Array<{ Id: string; Name: string; Path: string; RunTimeTicks?: number; SeriesName?: string; SeriesId?: string; SeasonName?: string; IndexNumber?: number; ParentIndexNumber?: number }>> {
    const base = jellyfinBaseUrl.replace(/\/$/, '');
    const url = `${base}/Items?IncludeItemTypes=${mediaType}&Recursive=true&Fields=Path,RunTimeTicks,SeriesName,SeriesId,SeasonName,IndexNumber,ParentIndexNumber&api_key=${jellyfinApiToken}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Jellyfin Items API erreur ${res.status}`);
    const data = await res.json() as { Items: Array<{ Id: string; Name: string; Path: string; RunTimeTicks?: number; SeriesName?: string; SeriesId?: string; SeasonName?: string; IndexNumber?: number; ParentIndexNumber?: number }> };
    return data.Items ?? [];
  }

  async checkJellyfinStatus(cineClubId: number): Promise<{ online: boolean; version?: string; serverName?: string }> {
    const club = await this.prisma.cineClub.findUnique({ where: { id: cineClubId } });
    if (!club?.jellyfinBaseUrl || !club?.jellyfinApiToken) return { online: false };
    try {
      const base = club.jellyfinBaseUrl.replace(/\/$/, '');
      const res = await fetch(`${base}/System/Info?api_key=${club.jellyfinApiToken}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { online: false };
      const data = await res.json() as { Version?: string; ServerName?: string };
      return { online: true, version: data.Version, serverName: data.ServerName };
    } catch {
      return { online: false };
    }
  }

  async saveJellyfinConfig(cineClubId: number, jellyfinBaseUrl: string, jellyfinApiToken: string): Promise<void> {
    await this.prisma.cineClub.update({
      where: { id: cineClubId },
      data: { jellyfinBaseUrl, jellyfinApiToken },
    });
  }

  async getJellyfinConfigForClub(cineClubId: number): Promise<{ jellyfinBaseUrl: string | null; jellyfinApiToken: string | null }> {
    const club = await this.prisma.cineClub.findUnique({ where: { id: cineClubId }, select: { jellyfinBaseUrl: true, jellyfinApiToken: true } });
    if (!club) throw new ForbiddenException('CineClub introuvable');
    return { jellyfinBaseUrl: club.jellyfinBaseUrl, jellyfinApiToken: club.jellyfinApiToken };
  }

  async getMediaTracksForJellyfin(
    mediaId: number,
    cineClubId: number,
  ): Promise<MediaTracks | null> {
    const [media, club] = await Promise.all([
      this.prisma.media.findFirst({ where: { id: mediaId, cineClubId }, select: { sourceType: true, jellyfinItemId: true } }),
      this.prisma.cineClub.findUnique({ where: { id: cineClubId }, select: { jellyfinBaseUrl: true, jellyfinApiToken: true } }),
    ]);
    if (!media || media.sourceType !== 'SEEDBOX' || !media.jellyfinItemId || !club?.jellyfinBaseUrl || !club?.jellyfinApiToken) {
      return null;
    }
    return this.getJellyfinPlaybackInfo(club.jellyfinBaseUrl, club.jellyfinApiToken, media.jellyfinItemId);
  }

  async getEpisodeTracksForJellyfin(
    episodeId: number,
    cineClubId: number,
  ): Promise<MediaTracks | null> {
    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, season: { media: { cineClubId } } },
      select: { sourceType: true, jellyfinItemId: true, season: { select: { media: { select: { cineClubId: true } } } } },
    });
    const club = await this.prisma.cineClub.findUnique({ where: { id: cineClubId }, select: { jellyfinBaseUrl: true, jellyfinApiToken: true } });
    if (!episode || episode.sourceType !== 'SEEDBOX' || !episode.jellyfinItemId || !club?.jellyfinBaseUrl || !club?.jellyfinApiToken) {
      return null;
    }
    return this.getJellyfinPlaybackInfo(club.jellyfinBaseUrl, club.jellyfinApiToken, episode.jellyfinItemId);
  }

  // ── NAS subtitle extraction & cache ────────────────────────────────────────

  private async extractSubtitleTrack(
    nasFileUrl: string,
    trackIdx: number,
    onProgress?: (percent: number) => void,
  ): Promise<string> {
    // Comme probeMediaTracks : lecture via Node pipée dans stdin (le build Linux de
    // ffmpeg-static ne peut pas ouvrir l'URL https lui-même). Les paquets sous-titres
    // étant entrelacés sur tout le conteneur, FFmpeg doit démuxer le fichier entier —
    // plusieurs minutes pour un gros média, d'où le timeout large. Résultat caché en DB.
    const nasRes = await this.openNasFileStream(nasFileUrl, 15_000);

    const totalBytes = Number(nasRes.headers['content-length']) || 0;
    if (onProgress && totalBytes > 0) {
      let readBytes = 0;
      let lastPercent = 0;
      nasRes.on('data', (chunk: Buffer) => {
        readBytes += chunk.length;
        const percent = Math.min(99, Math.floor((readBytes / totalBytes) * 100));
        if (percent > lastPercent) { lastPercent = percent; onProgress(percent); }
      });
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, [
        '-i', 'pipe:0',
        '-map', `0:s:${trackIdx}`,
        '-c:s', 'webvtt',
        '-f', 'webvtt',
        'pipe:1',
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      const chunks: Buffer[] = [];
      proc.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
      let stderrTail = '';
      proc.stderr?.on('data', (chunk: Buffer) => { stderrTail = (stderrTail + chunk.toString()).slice(-1000); });
      proc.stdin?.on('error', () => {});
      nasRes.on('error', () => {});
      nasRes.pipe(proc.stdin!);

      const kill = setTimeout(() => proc.kill('SIGKILL'), 15 * 60_000);
      proc.on('close', (code) => {
        clearTimeout(kill);
        nasRes.destroy();
        const text = Buffer.concat(chunks).toString('utf-8').trim();
        if (text.startsWith('WEBVTT')) resolve(text);
        else reject(new Error(`FFmpeg subtitle extraction empty (code ${code}) — stderr: ${stderrTail.replace(/\s+/g, ' ').slice(-400)}`));
      });
      proc.on('error', (err) => { clearTimeout(kill); nasRes.destroy(); reject(err); });
    });
  }

  /**
   * Extraction d'UNE piste sous-titre à la demande (cache-first).
   * La liste des pistes est fournie côté client par le sondage rapide (`probeMediaTracks`) ;
   * ici on n'extrait le VTT — opération lente qui lit tout le fichier depuis le NAS — que pour
   * la piste réellement sélectionnée, puis on la met en cache DB pour les lectures suivantes.
   */
  /**
   * Exécution d'une commande sur la seedbox via SSH (clé en DB), avec timeout dur.
   * Utilisée pour l'extraction sous-titres NAS ; équivalent simplifié de
   * JobsProcessor.execSsh (rsync), avec accès au flux stderr pour la progression.
   */
  private execSeedboxSsh(p: {
    host: string;
    port: number;
    user: string;
    privateKey: string;
    passphrase?: string;
    command: string;
    timeoutMs: number;
    onStderr?: (chunk: string) => void;
  }): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const client = new SshClient();
      let stdout = '';
      let stderr = '';
      let settled = false;
      const done = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(kill); fn(); } };
      const kill = setTimeout(() => {
        done(() => { client.end(); reject(new Error(`Timeout SSH (${p.timeoutMs}ms)`)); });
      }, p.timeoutMs);

      client
        .on('ready', () => {
          client.exec(p.command, (err, stream) => {
            if (err) { done(() => { client.end(); reject(err); }); return; }
            stream
              .on('close', (code: number | null) => {
                client.end();
                done(() => resolve({ code: code ?? -1, stdout, stderr }));
              })
              .on('data', (data: Buffer) => { stdout += data.toString('utf8'); })
              .stderr.on('data', (data: Buffer) => {
                const chunk = data.toString('utf8');
                stderr = (stderr + chunk).slice(-4000);
                p.onStderr?.(chunk);
              });
          });
        })
        .on('error', (err) => done(() => reject(err)))
        .connect({
          host: p.host,
          port: p.port,
          username: p.user,
          privateKey: p.privateKey,
          passphrase: p.passphrase,
          readyTimeout: 30_000,
        });
    });
  }

  /** Chemins physiques candidats sur le NAS pour un nasPath File Station (/video/… → /volumeN/video/…). */
  private physicalPathCandidates(nasPath: string): string[] {
    const trimmed = nasPath.trim();
    const clean = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    if (/^\/volume\d+\//i.test(clean)) return [clean];
    return ['/volume1', '/volume2', '/volume3', '/volume4'].map((v) => `${v}${clean}`).concat([clean]);
  }

  /**
   * Extraction d'une piste sous-titre en exécutant FFmpeg SUR le NAS (lecture disque
   * locale, quelques dizaines de secondes) via la chaîne SSH déjà utilisée par rsync :
   * Railway → seedbox (clé en DB) → NAS (clé seedboxToNasKeyPath). Seul le VTT (~100 Ko)
   * transite par le réseau, au lieu de relire tout le fichier à travers Internet.
   */
  private async extractSubtitleTrackViaNasSsh(
    cineClubId: number,
    nasPath: string,
    trackIdx: number,
    durationSeconds: number,
    onProgress: (percent: number) => void,
  ): Promise<string> {
    const club = await this.prisma.cineClub.findUnique({ where: { id: cineClubId } });
    if (!club?.seedboxSshHost || !club.seedboxSshUser || !club.seedboxSshPrivateKey || !club.nasSshHost || !club.nasSshUser) {
      throw new Error('chaîne SSH seedbox→NAS non configurée pour ce CineClub');
    }

    // Script exécuté sur le NAS : détection du binaire FFmpeg DSM + du chemin physique,
    // puis extraction VTT vers stdout. -progress pipe:2 → progression sur stderr.
    const innerScript = [
      'FF=""; for c in ffmpeg /usr/bin/ffmpeg /var/packages/VideoStation/target/bin/ffmpeg /var/packages/MediaServer/target/bin/ffmpeg /var/packages/CodecPack/target/bin/ffmpeg41 /var/packages/ffmpeg6/target/bin/ffmpeg /var/packages/ffmpeg/target/bin/ffmpeg; do command -v "$c" >/dev/null 2>&1 && { FF="$c"; break; }; done',
      '[ -n "$FF" ] || { echo NOFFMPEG >&2; exit 42; }',
      `F=""; for p in ${this.physicalPathCandidates(nasPath).map(shellEscape).join(' ')}; do [ -f "$p" ] && { F="$p"; break; }; done`,
      '[ -n "$F" ] || { echo NOFILE >&2; exit 43; }',
      `exec "$FF" -nostdin -v error -progress pipe:2 -i "$F" -map 0:s:${trackIdx} -c:s webvtt -f webvtt pipe:1`,
    ].join('\n');

    const sshOpts = ['-o StrictHostKeyChecking=accept-new', `-p ${club.nasSshPort}`];
    if (club.seedboxToNasKeyPath) {
      sshOpts.push(`-o IdentityFile=${shellEscape(club.seedboxToNasKeyPath)}`, '-o IdentitiesOnly=yes');
    }
    const command = `ssh ${sshOpts.join(' ')} ${shellEscape(`${club.nasSshUser}@${club.nasSshHost}`)} ${shellEscape(innerScript)}`;

    const result = await this.execSeedboxSsh({
      host: club.seedboxSshHost,
      port: club.seedboxSshPort,
      user: club.seedboxSshUser,
      privateKey: this.crypto.decrypt(club.seedboxSshPrivateKey),
      passphrase: club.seedboxSshPassphrase ? this.crypto.decrypt(club.seedboxSshPassphrase) : undefined,
      command,
      timeoutMs: 10 * 60_000,
      onStderr: (chunk) => {
        // Lignes -progress : out_time=HH:MM:SS.micros — position de démux dans le fichier
        const m = chunk.match(/out_time=(\d+):(\d+):(\d+)/g);
        if (!m || durationSeconds <= 0) return;
        const last = m[m.length - 1].match(/out_time=(\d+):(\d+):(\d+)/);
        if (!last) return;
        const seconds = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
        onProgress(Math.min(99, Math.floor((seconds / durationSeconds) * 100)));
      },
    });

    const vtt = result.stdout.trim();
    if (result.code !== 0 || !vtt.startsWith('WEBVTT')) {
      throw new Error(`FFmpeg NAS exit=${result.code} — stderr: ${result.stderr.replace(/\s+/g, ' ').slice(-300)}`);
    }
    return vtt;
  }

  // Extraction en arrière-plan par média/piste : le endpoint répond immédiatement
  // « pending » + progression, et le client re-sonde jusqu'au VTT — aucune connexion
  // HTTP longue (l'edge Railway coupe les requêtes qui durent plusieurs minutes).
  private subtitleExtractInFlight = new Map<string, { progressPercent: number }>();
  // Échec d'extraction conservé jusqu'au poll suivant, qui le remonte en erreur HTTP.
  private subtitleExtractErrors = new Map<string, string>();

  private async getNasSubtitleTrack(
    filter: { mediaId?: number; episodeId?: number },
    trackIdx: number,
    source: {
      cineClubId: number;
      nasPath: string | null;
      durationSeconds: number;
      nasUrlFactory: () => Promise<string>;
    },
    meta: { language?: string; title?: string; codec?: string },
  ): Promise<NasSubtitleTrack> {
    const cached = await this.prisma.subtitleCache.findFirst({ where: { ...filter, trackIdx } });
    if (cached) {
      this.logger.log(`[subtitles] cache hit ${JSON.stringify(filter)} track ${trackIdx}`);
      return { trackIdx: cached.trackIdx, language: cached.language, title: cached.title, codec: cached.codec, vttContent: cached.vttContent };
    }

    const key = `${filter.mediaId ?? `ep${filter.episodeId}`}:${trackIdx}`;
    const language = meta.language || 'und';
    const title = meta.title || '';
    const codec = meta.codec || '';
    const pendingResponse = (progressPercent: number): NasSubtitleTrack =>
      ({ trackIdx, language, title, codec, vttContent: '', pending: true, progressPercent });

    const failure = this.subtitleExtractErrors.get(key);
    if (failure !== undefined) {
      this.subtitleExtractErrors.delete(key);
      throw new BadRequestException(`Extraction sous-titre échouée : ${failure}`);
    }

    const inFlight = this.subtitleExtractInFlight.get(key);
    if (inFlight) return pendingResponse(inFlight.progressPercent);

    const entry = { progressPercent: 0 };
    this.subtitleExtractInFlight.set(key, entry);
    this.logger.log(`[subtitles] extraction start ${key} (${language})`);

    void (async () => {
      const onProgress = (p: number) => { entry.progressPercent = p; };

      // 1) FFmpeg sur le NAS via SSH (rapide : lecture disque locale, seul le VTT transite)
      let vttContent: string | null = null;
      if (source.nasPath) {
        try {
          vttContent = await this.extractSubtitleTrackViaNasSsh(source.cineClubId, source.nasPath, trackIdx, source.durationSeconds, onProgress);
          this.logger.log(`[subtitles] extraction NAS-side OK ${key}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(`[subtitles] extraction NAS-side impossible (${message}) — fallback HTTP ${key}`);
          entry.progressPercent = 0;
        }
      }

      // 2) Fallback : FFmpeg sur Railway en relisant le fichier via HTTP (lent)
      if (!vttContent) {
        const nasUrl = await source.nasUrlFactory();
        vttContent = await this.extractSubtitleTrack(nasUrl, trackIdx, onProgress);
      }

      await this.prisma.subtitleCache.create({ data: { ...filter, trackIdx, language, title, codec, vttContent } });
      this.logger.log(`[subtitles] track ${trackIdx} (${language}) extracted & cached ${JSON.stringify(filter)}`);
    })()
      .catch((err: Error & { code?: string }) => {
        // AggregateError réseau (ECONNREFUSED…) : message vide, le code est plus parlant
        const message = err?.message || err?.code || String(err);
        this.logger.error(`[subtitles] extraction ${key} échouée : ${message}`);
        this.subtitleExtractErrors.set(key, message);
      })
      .finally(() => this.subtitleExtractInFlight.delete(key));

    return pendingResponse(0);
  }

  async getNasSubtitleTrackForMedia(
    mediaId: number, trackIdx: number, userId: number, cineClubId: number,
    meta: { language?: string; title?: string; codec?: string } = {},
  ): Promise<NasSubtitleTrack> {
    const media = await this.prisma.media.findFirst({
      where: { id: mediaId, cineClubId },
      select: { nasPath: true, runtime: true },
    });
    return this.getNasSubtitleTrack({ mediaId }, trackIdx, {
      cineClubId,
      nasPath: media?.nasPath ?? null,
      durationSeconds: (media?.runtime ?? 0) * 60,
      nasUrlFactory: () => this.getMediaFileUrl(mediaId, userId, cineClubId),
    }, meta);
  }

  async getNasSubtitleTrackForEpisode(
    episodeId: number, trackIdx: number, userId: number, cineClubId: number,
    meta: { language?: string; title?: string; codec?: string } = {},
  ): Promise<NasSubtitleTrack> {
    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, season: { media: { cineClubId } } },
      select: { nasPath: true, runtime: true },
    });
    return this.getNasSubtitleTrack({ episodeId }, trackIdx, {
      cineClubId,
      nasPath: episode?.nasPath ?? null,
      durationSeconds: (episode?.runtime ?? 0) * 60,
      nasUrlFactory: () => this.getEpisodeFileUrl(episodeId, userId, cineClubId),
    }, meta);
  }

  async deleteFile(session: NasSession, path: string): Promise<void> {
    // SYNO.FileStation.Delete attend `path` comme JSON array (même pour un seul fichier),
    // sinon Synology cherche un fichier nommé littéralement comme la chaîne et renvoie 408.
    // method=delete est synchrone : success=true ne remonte que si le fichier est réellement supprimé.
    // Le chemin doit être relatif au dossier partagé (/video/…) : un chemin physique
    // /volume1/video/… fait chercher un dossier partagé « volume1 » → 408 alors que le fichier existe.
    const fsPath = this.normalizeFileStationPath(path);
    const result = await this.request(session.baseUrl, {
      api: 'SYNO.FileStation.Delete',
      version: '2',
      method: 'delete',
      path: JSON.stringify([fsPath]),
      _sid: session.sid,
    });

    if (!result.success) {
      throw new Error(`Impossible de supprimer le fichier : ${JSON.stringify(result.error)}`);
    }
  }
}
