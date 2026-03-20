import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createSocket } from 'node:dgram';
import { lookup } from 'node:dns/promises';
import { PrismaService } from '../common/prisma.service';
import { parseMediaFilename } from '../common/media-parser';

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

interface VideoStationVideo {
  id: number;
  title?: string;
  file?: VideoStationFile[];
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

  constructor(private readonly prisma: PrismaService) {}

  private async request<T>(baseUrl: string, params: Record<string, string>): Promise<SynoResponse<T>> {
    const url = new URL('/webapi/entry.cgi', baseUrl);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
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

    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    const result: SynoResponse<{ sid: string }> = await response.json();

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

  private buildFileStationUrl(baseUrl: string, path: string, sid: string, mode: 'stream' | 'download'): string {
    const url = new URL('/webapi/entry.cgi', baseUrl);
    url.searchParams.set('api', 'SYNO.FileStation.Download');
    url.searchParams.set('version', '2');
    url.searchParams.set('method', 'download');
    url.searchParams.set('path', path);
    url.searchParams.set('mode', mode === 'stream' ? 'open' : 'download');
    url.searchParams.set('_sid', sid);
    return url.toString();
  }

  async getStreamUrl(
    mediaId: number,
    userId: number,
    cineClubId: number,
    mode: 'stream' | 'download',
  ): Promise<{ nasUrl: string; durationSeconds: number; isHls: boolean }> {
    const [member, media, club] = await Promise.all([
      this.prisma.cineClubMember.findUnique({ where: { userId_cineClubId: { userId, cineClubId } } }),
      this.prisma.media.findFirst({ where: { id: mediaId, cineClubId } }),
      this.prisma.cineClub.findUnique({ where: { id: cineClubId } }),
    ]);

    if (!member?.nasUsername || !member?.nasPassword) {
      throw new UnauthorizedException('Credentials NAS non configurés pour ce membre');
    }
    if (!media?.nasPath) throw new NotFoundException('Fichier introuvable sur le NAS');
    if (!club?.nasBaseUrl) throw new BadRequestException('NAS non configuré pour ce CineClub');

    const durationSeconds = (media.runtime ?? 0) * 60;

    if (mode === 'stream') {
      try {
        const vsSession = await this.login(club.nasBaseUrl, member.nasUsername, member.nasPassword, 'VideoStation');
        // Title hints: ptt title from nasFilename (primary), then TMDB VF & original
        const { title: pttTitle } = parseMediaFilename(media.nasFilename);
        const titleHints = [pttTitle, media.titleVf, media.titleOriginal].filter(Boolean) as string[];
        const vsVideo = await this.findVideoStationVideo(vsSession, media.nasPath, titleHints);
        if (vsVideo) {
          const hlsUrl = await this.openVideoStationStream(vsSession, vsVideo.videoId);
          if (hlsUrl) {
            this.logger.log(`[Stream #${mediaId}] VideoStation HLS OK`);
            return { nasUrl: hlsUrl, durationSeconds, isHls: true };
          }
        }
      } catch (err) {
        this.logger.warn(`[Stream #${mediaId}] VideoStation unavailable, falling back to FFmpeg: ${err}`);
      }
    }

    const session = await this.login(club.nasBaseUrl, member.nasUsername, member.nasPassword);
    return {
      nasUrl: this.buildFileStationUrl(club.nasBaseUrl, media.nasPath, session.sid, mode),
      durationSeconds,
      isHls: false,
    };
  }

  async getEpisodeStreamUrl(
    episodeId: number,
    userId: number,
    cineClubId: number,
    mode: 'stream' | 'download',
  ): Promise<{ nasUrl: string; durationSeconds: number; isHls: boolean }> {
    const [member, episode] = await Promise.all([
      this.prisma.cineClubMember.findUnique({ where: { userId_cineClubId: { userId, cineClubId } } }),
      this.prisma.episode.findFirst({
        where: { id: episodeId, season: { media: { cineClubId } } },
        select: { nasPath: true, nasFilename: true, runtime: true, season: { select: { media: { select: { titleVf: true, titleOriginal: true } } } } },
      }),
    ]);

    if (!member?.nasUsername || !member?.nasPassword) {
      throw new UnauthorizedException('Credentials NAS non configurés pour ce membre');
    }
    if (!episode?.nasPath) throw new NotFoundException('Fichier épisode introuvable sur le NAS');

    const club = await this.prisma.cineClub.findUnique({ where: { id: cineClubId } });
    if (!club?.nasBaseUrl) throw new BadRequestException('NAS non configuré pour ce CineClub');

    const durationSeconds = (episode.runtime ?? 0) * 60;

    if (mode === 'stream') {
      try {
        const vsSession = await this.login(club.nasBaseUrl, member.nasUsername, member.nasPassword, 'VideoStation');
        const nasFilename = episode.nasFilename ?? episode.nasPath.split('/').pop() ?? '';
        const { title: pttTitle } = parseMediaFilename(nasFilename);
        const seriesMedia = episode.season?.media;
        const titleHints = [pttTitle, seriesMedia?.titleVf, seriesMedia?.titleOriginal].filter(Boolean) as string[];
        const vsVideo = await this.findVideoStationVideo(vsSession, episode.nasPath, titleHints);
        if (vsVideo) {
          const hlsUrl = await this.openVideoStationStream(vsSession, vsVideo.videoId);
          if (hlsUrl) {
            this.logger.log(`[Stream episode #${episodeId}] VideoStation HLS OK`);
            return { nasUrl: hlsUrl, durationSeconds, isHls: true };
          }
        }
      } catch (err) {
        this.logger.warn(`[Stream episode #${episodeId}] VideoStation unavailable, falling back to FFmpeg: ${err}`);
      }
    }

    const session = await this.login(club.nasBaseUrl, member.nasUsername, member.nasPassword);
    return {
      nasUrl: this.buildFileStationUrl(club.nasBaseUrl, episode.nasPath, session.sid, mode),
      durationSeconds,
      isHls: false,
    };
  }

  // ── Wake-on-LAN ────────────────────────────────────────────────────────────

  async sendWakeOnLan(cineClubId: number): Promise<void> {
    const club = await this.prisma.cineClub.findUnique({ where: { id: cineClubId } });
    if (!club?.nasWolMac) throw new BadRequestException('Adresse MAC WoL non configurée pour ce CineClub');
    if (!club.nasWolHost) throw new BadRequestException('Hôte WoL non configuré pour ce CineClub');

    const mac = club.nasWolMac.replace(/[:\-\s]/g, '');
    if (mac.length !== 12) throw new BadRequestException('Adresse MAC invalide (format attendu: XX:XX:XX:XX:XX:XX)');

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
      address = club.nasWolHost; // fallback : utiliser tel quel si déjà une IP
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

    this.logger.log(`[WoL] Magic packet envoyé → ${address}:${port} (MAC: ${club.nasWolMac})`);
  }

  // ── VideoStation ──────────────────────────────────────────────────────────

  /**
   * Searches for a video in the VideoStation library.
   * Strategy:
   *  1. Path match against `nasPath` (most reliable)
   *  2. Title match using hints: ptt-extracted filename title, TMDB titles (VF + original)
   * Tries VideoStation2 (DSM 7+) then VideoStation1 (DSM 6) for compatibility.
   */
  private async findVideoStationVideo(
    session: NasSession,
    nasPath: string,
    titleHints: string[],
  ): Promise<{ videoId: number } | null> {
    const normalize = (s: string) =>
      s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

    for (const api of ['SYNO.VideoStation2.Video', 'SYNO.VideoStation.Video']) {
      try {
        const result = await this.request<{ total: number; video?: VideoStationVideo[] }>(
          session.baseUrl,
          { api, version: '1', method: 'list', library_id: '0', offset: '0', limit: '5000', additional: '["file"]', _sid: session.sid },
        );
        if (!result.success || !result.data?.video?.length) continue;

        // 1. Path match
        for (const video of result.data.video) {
          if ((video.file ?? []).some((f) => f.path === nasPath)) {
            this.logger.log(`[VideoStation] Found by path: "${video.title}" (id=${video.id})`);
            return { videoId: video.id };
          }
        }

        // 2. Title match — use all hints (ptt title from filename, TMDB VF, TMDB original)
        const needles = titleHints.filter(Boolean).map(normalize).filter((n) => n.length >= 3);
        for (const video of result.data.video) {
          const vt = normalize(video.title ?? '');
          if (needles.some((n) => vt === n || vt.startsWith(n + ' ') || n.startsWith(vt + ' '))) {
            this.logger.log(`[VideoStation] Found by title: "${video.title}" (id=${video.id})`);
            return { videoId: video.id };
          }
        }

        return null; // API responded but no match found
      } catch (err) {
        this.logger.debug(`[VideoStation] ${api} list failed: ${err}`);
      }
    }
    return null;
  }

  private async openVideoStationStream(session: NasSession, videoId: number): Promise<string | null> {
    for (const api of ['SYNO.VideoStation2.Streaming', 'SYNO.VideoStation.Streaming']) {
      try {
        const result = await this.request<{ playlist_url?: string }>(
          session.baseUrl,
          { api, version: '1', method: 'open', id: String(videoId), accept_format: 'm3u8', transcode: '1', _sid: session.sid },
        );
        if (result.success && result.data?.playlist_url) {
          let url = result.data.playlist_url;
          if (url.startsWith('/')) {
            url = `${session.baseUrl.replace(/\/$/, '')}${url}`;
          }
          return url;
        }
      } catch (err) {
        this.logger.debug(`[VideoStation] ${api} stream open failed: ${err}`);
      }
    }
    return null;
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
