import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSocket } from 'node:dgram';
import { lookup } from 'node:dns/promises';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as https from 'node:https';
import * as http from 'node:http';
import { PrismaService } from '../common/prisma.service';
import { parseMediaFilename } from '../common/media-parser';

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
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath: string = require('ffmpeg-static');

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
}

export interface MediaTracks {
  audio: AudioTrackInfo[];
  subtitles: SubtitleTrackInfo[];
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
export class NasService {
  private readonly logger = new Logger(NasService.name);

  /** Évite deux logins FileStation concurrents (même NAS / même user) : la 2ᵉ session invalide souvent la 1ʳᵉ → 404 sur fileproxy. */
  private readonly fileStationSessionTtlMs = 4 * 60 * 1000;
  private fileStationSidByKey = new Map<string, { sid: string; expiresAt: number }>();
  private fileStationLoginInFlight = new Map<string, Promise<NasSession>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

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
  ): Promise<{ nasUrl: string; durationSeconds: number; isHls: boolean; sourceType?: string; jellyfinItemId?: string; jellyfinBaseUrl?: string; jellyfinApiToken?: string }> {
    const [member, media, club] = await Promise.all([
      this.prisma.cineClubMember.findUnique({ where: { userId_cineClubId: { userId, cineClubId } } }),
      this.prisma.media.findFirst({ where: { id: mediaId, cineClubId } }),
      this.prisma.cineClub.findUnique({ where: { id: cineClubId } }),
    ]);

    if (!media?.nasPath) throw new NotFoundException('Fichier introuvable sur le NAS');
    if (!club) throw new BadRequestException('CineClub introuvable');

    const durationSeconds = (media.runtime ?? 0) * 60;

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
      const url = this.buildJellyfinStreamUrl(club.jellyfinBaseUrl, club.jellyfinApiToken, media.jellyfinItemId);
      this.logger.log(`[Stream #${mediaId}] Jellyfin passthrough → ${url.slice(0, 80)}…`);
      return { nasUrl: url, durationSeconds, isHls: true, sourceType: 'SEEDBOX', jellyfinItemId: media.jellyfinItemId, jellyfinBaseUrl: club.jellyfinBaseUrl, jellyfinApiToken: club.jellyfinApiToken };
    }
    // ── FIN branchement SEEDBOX ───────────────────────────────────────────────

    if (!member?.nasUsername || !member?.nasPassword) {
      throw new UnauthorizedException('Credentials NAS non configurés pour ce membre');
    }
    if (!club.nasBaseUrl) throw new BadRequestException('NAS non configuré pour ce CineClub');

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
  ): Promise<{ nasUrl: string; durationSeconds: number; isHls: boolean; sourceType?: string; jellyfinItemId?: string; jellyfinBaseUrl?: string; jellyfinApiToken?: string }> {
    const [member, episode] = await Promise.all([
      this.prisma.cineClubMember.findUnique({ where: { userId_cineClubId: { userId, cineClubId } } }),
      this.prisma.episode.findFirst({
        where: { id: episodeId, season: { media: { cineClubId } } },
        select: { nasPath: true, nasFilename: true, runtime: true, sourceType: true, jellyfinItemId: true, season: { select: { media: { select: { titleVf: true, titleOriginal: true } } } } },
      }),
    ]);

    if (!episode) throw new NotFoundException('Épisode introuvable');

    const club = await this.prisma.cineClub.findUnique({ where: { id: cineClubId } });
    if (!club) throw new BadRequestException('CineClub introuvable');

    const durationSeconds = (episode.runtime ?? 0) * 60;

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
      const url = this.buildJellyfinStreamUrl(club.jellyfinBaseUrl, club.jellyfinApiToken, episode.jellyfinItemId);
      this.logger.log(`[Stream ep#${episodeId}] Jellyfin passthrough → ${url.slice(0, 80)}…`);
      return { nasUrl: url, durationSeconds, isHls: true, sourceType: 'SEEDBOX', jellyfinItemId: episode.jellyfinItemId, jellyfinBaseUrl: club.jellyfinBaseUrl, jellyfinApiToken: club.jellyfinApiToken };
    }
    // ── FIN branchement SEEDBOX ───────────────────────────────────────────────

    if (!member?.nasUsername || !member?.nasPassword) {
      throw new UnauthorizedException('Credentials NAS non configurés pour ce membre');
    }
    if (!episode.nasPath) throw new NotFoundException('Fichier épisode introuvable sur le NAS');
    if (!club.nasBaseUrl) throw new BadRequestException('NAS non configuré pour ce CineClub');

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

  async sendWakeOnLan(cineClubId: number): Promise<void> {
    const club = await this.prisma.cineClub.findUnique({ where: { id: cineClubId } });
    if (!club?.nasWolMac) throw new BadRequestException('Adresse MAC WoL non configurée pour ce CineClub');

    const mac = club.nasWolMac.replace(/[:\-\s]/g, '');
    if (mac.length !== 12) throw new BadRequestException('Adresse MAC invalide (format attendu: XX:XX:XX:XX:XX:XX)');

    // Méthode préférée : API Freebox (fiable depuis internet)
    if (club.freeboxApiUrl && club.freeboxAppToken) {
      const appToken = this.decryptToken(club.freeboxAppToken);
      await this.sendWakeOnLanViaFreebox(club.freeboxApiUrl, appToken, club.nasWolMac);
      this.logger.log(`[WoL] Magic packet envoyé via Freebox API (MAC: ${club.nasWolMac})`);
      return;
    }

    // Fallback : UDP direct (nécessite port-forward broadcast côté routeur)
    if (!club.nasWolHost) throw new BadRequestException('Hôte WoL non configuré pour ce CineClub');

    const macBytes = mac.match(/.{2}/g)!.map((h) => parseInt(h, 16));

    // Magic packet : 6× 0xFF + 16× adresse MAC = 102 octets
    const packet = Buffer.alloc(102);
    for (let i = 0; i < 6; i++) packet[i] = 0xff;
    for (let i = 1; i <= 16; i++) macBytes.forEach((b, j) => { packet[i * 6 + j] = b; });

    // Résoudre l'hostname en IP (supporte DynDNS)
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

  async probeMediaTracks(nasFileUrl: string): Promise<MediaTracks> {
    return new Promise((resolve) => {
      // ffmpeg -i <url> prints stream info to stderr then exits with error (no output specified)
      const proc = spawn(ffmpegPath, [
        '-reconnect', '1', '-reconnect_streamed', '1', '-tls_verify', '0',
        '-i', nasFileUrl,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });

      let stderr = '';
      proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      const kill = setTimeout(() => proc.kill('SIGKILL'), 12_000);
      const done = () => { clearTimeout(kill); resolve(this.parseFfmpegStreamInfo(stderr)); };
      proc.on('close', done);
      proc.on('error', () => { clearTimeout(kill); resolve({ audio: [], subtitles: [] }); });
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
  ): string {
    const base = jellyfinBaseUrl.replace(/\/$/, '');
    // PlaySessionId: client-generated UUID required by Jellyfin to track the HLS session.
    // MediaSourceId: equals the item ID for single-file items (Jellyfin returns it via PlaybackInfo too).
    const params = new URLSearchParams({
      api_key: jellyfinApiToken,
      DeviceId: 'nasflix',
      MediaSourceId: jellyfinItemId,
      PlaySessionId: randomUUID(),
      // Force H.264 + AAC — browsers can't decode HEVC (hvc1) or Dolby audio (ec-3)
      VideoCodec: 'h264',
      AudioCodec: 'aac',
      // Disable copy-passthrough so Jellyfin actually transcodes to h264/aac
      AllowVideoStreamCopy: 'false',
      AllowAudioStreamCopy: 'false',
      Container: 'ts',
      TranscodingContainer: 'ts',
      SegmentContainer: 'ts',
      MinSegments: '1',
      static: 'false',
    });
    return `${base}/Videos/${jellyfinItemId}/master.m3u8?${params.toString()}`;
  }

  async getJellyfinPlaybackInfo(
    jellyfinBaseUrl: string,
    jellyfinApiToken: string,
    jellyfinItemId: string,
  ): Promise<MediaTracks> {
    const base = jellyfinBaseUrl.replace(/\/$/, '');
    const url = `${base}/Items/${jellyfinItemId}/PlaybackInfo?api_key=${jellyfinApiToken}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
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

  async deleteFile(session: NasSession, path: string): Promise<void> {
    const result = await this.request(session.baseUrl, {
      api: 'SYNO.FileStation.Delete',
      version: '2',
      method: 'start',
      path,
      _sid: session.sid,
    });

    if (!result.success) {
      throw new Error(`Impossible de supprimer le fichier : ${JSON.stringify(result.error)}`);
    }
  }
}
