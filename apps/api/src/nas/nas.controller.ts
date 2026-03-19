import { Controller, ForbiddenException, Get, Logger, Param, ParseIntPipe, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { Request, Response } from 'express';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath: string = require('ffmpeg-static');
import { NasService } from './nas.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Public } from '../auth/guards/public.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

@Controller('nas')
@UseGuards(RolesGuard)
export class NasController {
  private readonly logger = new Logger(NasController.name);

  constructor(
    private readonly nasService: NasService,
    private readonly configService: ConfigService,
  ) {}

  // ── Token helpers ──────────────────────────────────────────────────────────

  private get tokenSecret(): string {
    return this.configService.get<string>('JWT_SECRET', 'fallback-secret');
  }

  private signTranscodeToken(nasUrl: string): string {
    const exp = Math.floor(Date.now() / 1000) + 4 * 3600; // 4 hours
    const payload = Buffer.from(JSON.stringify({ url: nasUrl, exp })).toString('base64url');
    const sig = createHmac('sha256', this.tokenSecret).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }

  private verifyTranscodeToken(token: string): { url: string; exp: number } | null {
    const dot = token.lastIndexOf('.');
    if (dot < 0) return null;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = createHmac('sha256', this.tokenSecret).update(payload).digest('base64url');
    try {
      if (!timingSafeEqual(Buffer.from(sig, 'base64url'), Buffer.from(expected, 'base64url'))) return null;
    } catch {
      return null;
    }
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  @Get('status')
  async getStatus(@Req() req: { user: JwtPayload }) {
    if (!req.user.cineClubId) return { online: false, lastCheckedAt: new Date().toISOString() };

    const online = await this.nasService.checkStatusForCineClub(req.user.cineClubId);
    return { online, lastCheckedAt: new Date().toISOString() };
  }

  // ── Stream URLs ────────────────────────────────────────────────────────────

  @Get('stream/episode/:episodeId')
  async getEpisodeStreamUrl(
    @Param('episodeId', ParseIntPipe) episodeId: number,
    @Query('mode') mode: 'stream' | 'download' = 'stream',
    @Req() req: { user: JwtPayload },
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    const { nasUrl } = await this.nasService.getEpisodeStreamUrl(episodeId, req.user.sub, req.user.cineClubId, mode);

    if (mode === 'stream') {
      return { url: `/nas/transcode?t=${this.signTranscodeToken(nasUrl)}`, isHls: false };
    }
    return { url: nasUrl, isHls: false };
  }

  @Get('stream/:mediaId')
  async getStreamUrl(
    @Param('mediaId', ParseIntPipe) mediaId: number,
    @Query('mode') mode: 'stream' | 'download' = 'stream',
    @Req() req: { user: JwtPayload },
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    const { nasUrl } = await this.nasService.getStreamUrl(mediaId, req.user.sub, req.user.cineClubId, mode);

    if (mode === 'stream') {
      return { url: `/nas/transcode?t=${this.signTranscodeToken(nasUrl)}`, isHls: false };
    }
    return { url: nasUrl, isHls: false };
  }

  // ── FFmpeg transcode proxy ─────────────────────────────────────────────────

  @Get('transcode')
  @Public()
  transcode(
    @Query('t') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const data = this.verifyTranscodeToken(token);
    if (!data) { res.status(403).end(); return; }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-cache');
    // No Content-Length — chunked streaming

    const ffmpeg = spawn(ffmpegPath, [
      '-i', data.url,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ac', '2',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    req.on('close', () => { ffmpeg.kill('SIGKILL'); });

    ffmpeg.stderr?.on('data', (chunk: Buffer) => {
      this.logger.debug(`[FFmpeg] ${chunk.toString().trim()}`);
    });

    ffmpeg.on('error', (err) => {
      this.logger.error(`[FFmpeg] spawn error: ${err.message}`);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });

    ffmpeg.stdout?.pipe(res);
  }

  // ── HLS proxy (kept for future use) ───────────────────────────────────────

  private encodeUrl(url: string): string {
    return Buffer.from(url).toString('base64url');
  }

  private decodeUrl(token: string): string {
    return Buffer.from(token, 'base64url').toString('utf-8');
  }

  @Get('hls-manifest')
  async hlsManifest(
    @Query('src') src: string,
    @Req() req: { user: JwtPayload },
    @Res() res: Response,
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException();

    const nasUrl = this.decodeUrl(src);
    const nasRes = await fetch(nasUrl);
    if (!nasRes.ok) { res.status(502).end(); return; }

    const manifest = await nasRes.text();
    const nasOrigin = new URL(nasUrl).origin;

    const rewritten = manifest
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;

        let absoluteSegUrl: string;
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          absoluteSegUrl = trimmed;
        } else if (trimmed.startsWith('/')) {
          absoluteSegUrl = `${nasOrigin}${trimmed}`;
        } else {
          absoluteSegUrl = new URL(trimmed, nasUrl).toString();
        }

        return `/nas/hls-segment?src=${this.encodeUrl(absoluteSegUrl)}`;
      })
      .join('\n');

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(rewritten);
  }

  @Get('hls-segment')
  async hlsSegment(
    @Query('src') src: string,
    @Req() req: { user: JwtPayload },
    @Res() res: Response,
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException();

    const { pipeline } = await import('node:stream/promises');
    const { Readable } = await import('node:stream');

    const nasUrl = this.decodeUrl(src);
    const nasRes = await fetch(nasUrl);
    if (!nasRes.ok || !nasRes.body) { res.status(502).end(); return; }

    res.setHeader('Content-Type', nasRes.headers.get('content-type') || 'video/MP2T');
    await pipeline(Readable.fromWeb(nasRes.body as Parameters<typeof Readable.fromWeb>[0]), res);
  }
}
