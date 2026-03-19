import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

interface SynoResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: number };
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
  ): Promise<{ nasUrl: string; durationSeconds: number }> {
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

    const session = await this.login(club.nasBaseUrl, member.nasUsername, member.nasPassword);
    return {
      nasUrl: this.buildFileStationUrl(club.nasBaseUrl, media.nasPath, session.sid, mode),
      durationSeconds: (media.runtime ?? 0) * 60,
    };
  }

  async getEpisodeStreamUrl(
    episodeId: number,
    userId: number,
    cineClubId: number,
    mode: 'stream' | 'download',
  ): Promise<{ nasUrl: string; durationSeconds: number }> {
    const [member, episode] = await Promise.all([
      this.prisma.cineClubMember.findUnique({ where: { userId_cineClubId: { userId, cineClubId } } }),
      this.prisma.episode.findFirst({
        where: { id: episodeId, season: { media: { cineClubId } } },
        select: { nasPath: true, runtime: true },
      }),
    ]);

    if (!member?.nasUsername || !member?.nasPassword) {
      throw new UnauthorizedException('Credentials NAS non configurés pour ce membre');
    }
    if (!episode?.nasPath) throw new NotFoundException('Fichier épisode introuvable sur le NAS');

    const club = await this.prisma.cineClub.findUnique({ where: { id: cineClubId } });
    if (!club?.nasBaseUrl) throw new BadRequestException('NAS non configuré pour ce CineClub');

    const session = await this.login(club.nasBaseUrl, member.nasUsername, member.nasPassword);
    return {
      nasUrl: this.buildFileStationUrl(club.nasBaseUrl, episode.nasPath, session.sid, mode),
      durationSeconds: (episode.runtime ?? 0) * 60,
    };
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
