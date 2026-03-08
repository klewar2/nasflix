import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

interface SynoResponse<T = any> {
  success: boolean;
  data?: T;
  error?: { code: number };
}

export interface SynoFileInfo {
  path: string;
  name: string;
  isdir: boolean;
  additional?: {
    size?: number;
    time?: { mtime: number };
    real_path?: string;
  };
}

@Injectable()
export class NasService {
  private readonly logger = new Logger(NasService.name);
  private sid: string | null = null;

  constructor(private prisma: PrismaService) {}

  private async getConfig() {
    const config = await this.prisma.nasConfig.findFirst({ where: { isActive: true } });
    if (!config) throw new Error('No active NAS configuration found');
    return config;
  }

  private async request<T>(baseUrl: string, params: Record<string, string>): Promise<SynoResponse<T>> {
    const url = new URL('/webapi/entry.cgi', baseUrl);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10000),
    });

    return response.json();
  }

  async login(): Promise<string> {
    const config = await this.getConfig();
    // In production, decrypt passwordEnc
    const params = {
      api: 'SYNO.API.Auth',
      version: '6',
      method: 'login',
      account: config.username,
      passwd: config.passwordEnc, // TODO: decrypt
      session: 'FileStation',
      format: 'sid',
    };

    const url = new URL('/webapi/auth.cgi', config.baseUrl);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    const result: SynoResponse<{ sid: string }> = await response.json();

    if (!result.success || !result.data?.sid) {
      throw new Error(`NAS login failed: ${JSON.stringify(result.error)}`);
    }

    this.sid = result.data.sid;
    return this.sid;
  }

  async logout(): Promise<void> {
    if (!this.sid) return;
    const config = await this.getConfig();

    try {
      const url = new URL('/webapi/auth.cgi', config.baseUrl);
      url.searchParams.set('api', 'SYNO.API.Auth');
      url.searchParams.set('version', '6');
      url.searchParams.set('method', 'logout');
      url.searchParams.set('session', 'FileStation');
      await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
    } finally {
      this.sid = null;
    }
  }

  async checkStatus(): Promise<boolean> {
    try {
      const config = await this.getConfig();
      const url = new URL('/webapi/query.cgi', config.baseUrl);
      url.searchParams.set('api', 'SYNO.API.Info');
      url.searchParams.set('version', '1');
      url.searchParams.set('method', 'query');

      const response = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
      const result: SynoResponse = await response.json();

      if (result.success) {
        await this.prisma.nasConfig.updateMany({
          where: { isActive: true },
          data: { lastOnlineAt: new Date() },
        });
      }

      return result.success;
    } catch {
      return false;
    }
  }

  async listFiles(folderPath: string, offset = 0, limit = 500): Promise<SynoFileInfo[]> {
    const config = await this.getConfig();
    if (!this.sid) await this.login();

    const result = await this.request<{ files: SynoFileInfo[]; total: number; offset: number }>(
      config.baseUrl,
      {
        api: 'SYNO.FileStation.List',
        version: '2',
        method: 'list',
        folder_path: folderPath,
        additional: 'size,time,real_path',
        offset: String(offset),
        limit: String(limit),
        _sid: this.sid!,
      },
    );

    if (!result.success) {
      throw new Error(`Failed to list files: ${JSON.stringify(result.error)}`);
    }

    return result.data?.files || [];
  }

  async listAllVideoFiles(): Promise<SynoFileInfo[]> {
    const config = await this.getConfig();
    const allFiles: SynoFileInfo[] = [];

    for (const folder of config.sharedFolders) {
      try {
        const files = await this.listFilesRecursive(folder, config.baseUrl);
        allFiles.push(...files);
      } catch (error) {
        this.logger.warn(`Failed to scan folder ${folder}: ${error}`);
      }
    }

    return allFiles;
  }

  private async listFilesRecursive(folderPath: string, baseUrl: string): Promise<SynoFileInfo[]> {
    const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.m4v', '.ts'];
    const allFiles: SynoFileInfo[] = [];
    let offset = 0;
    const limit = 500;

    while (true) {
      const files = await this.listFiles(folderPath, offset, limit);
      if (files.length === 0) break;

      for (const file of files) {
        if (file.isdir) {
          const subFiles = await this.listFilesRecursive(file.path, baseUrl);
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

  async deleteFile(path: string): Promise<void> {
    const config = await this.getConfig();
    if (!this.sid) await this.login();

    const result = await this.request(config.baseUrl, {
      api: 'SYNO.FileStation.Delete',
      version: '2',
      method: 'start',
      path: path,
      _sid: this.sid!,
    });

    if (!result.success) {
      throw new Error(`Failed to delete file: ${JSON.stringify(result.error)}`);
    }
  }

  async getNasConfig() {
    const config = await this.getConfig();
    return {
      id: config.id,
      name: config.name,
      baseUrl: config.baseUrl,
      username: config.username,
      sharedFolders: config.sharedFolders,
      isActive: config.isActive,
      lastOnlineAt: config.lastOnlineAt,
      lastSyncAt: config.lastSyncAt,
    };
  }

  async updateConfig(data: { baseUrl?: string; username?: string; password?: string; sharedFolders?: string[] }) {
    const existing = await this.prisma.nasConfig.findFirst({ where: { isActive: true } });

    const updateData: any = {};
    if (data.baseUrl) updateData.baseUrl = data.baseUrl;
    if (data.username) updateData.username = data.username;
    if (data.password) updateData.passwordEnc = data.password; // TODO: encrypt
    if (data.sharedFolders) updateData.sharedFolders = data.sharedFolders;

    if (existing) {
      return this.prisma.nasConfig.update({ where: { id: existing.id }, data: updateData });
    }

    return this.prisma.nasConfig.create({
      data: {
        baseUrl: data.baseUrl || '',
        username: data.username || '',
        passwordEnc: data.password || '',
        sharedFolders: data.sharedFolders || [],
        ...updateData,
      },
    });
  }
}
