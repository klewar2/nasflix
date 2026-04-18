import { Body, Controller, ForbiddenException, Get, Logger, Param, ParseIntPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { basename } from 'node:path';
import { spawn } from 'node:child_process';
import type { Request, Response } from 'express';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath: string = require('ffmpeg-static');
import { NasService } from './nas.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { Public } from '../auth/guards/public.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { MemberRole } from '@prisma/client';

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

  // ── Jellyfin proxy tokens ──────────────────────────────────────────────────

  /** Signs a short-lived token embedding Jellyfin connection details for the public HLS proxy. */
  private signJellyfinProxyToken(jellyfinBaseUrl: string, jellyfinApiToken: string, jellyfinItemId: string, durationSeconds: number): string {
    const exp = Math.floor(Date.now() / 1000) + 4 * 3600;
    const payload = Buffer.from(
      JSON.stringify({ base: jellyfinBaseUrl, key: jellyfinApiToken, item: jellyfinItemId, duration: durationSeconds, exp }),
    ).toString('base64url');
    const sig = createHmac('sha256', this.tokenSecret).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }

  private verifyJellyfinProxyToken(token: string): { base: string; key: string; item: string; duration: number } | null {
    const dot = token.lastIndexOf('.');
    if (dot < 0) return null;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = createHmac('sha256', this.tokenSecret).update(payload).digest('base64url');
    try {
      if (!timingSafeEqual(Buffer.from(sig, 'base64url'), Buffer.from(expected, 'base64url'))) return null;
    } catch { return null; }
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
      base: string; key: string; item: string; duration: number; exp: number;
    };
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  }

  /** Rewrites all non-comment HLS lines to go through /nas/jellyfin-seg, resolving relative URLs using manifestUrl as base. */
  private rewriteJellyfinManifest(manifest: string, manifestUrl: string, jellyfinOrigin: string, token: string): string {
    return manifest.split('\n').map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      let absUrl: string;
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        absUrl = trimmed;
      } else if (trimmed.startsWith('/')) {
        absUrl = `${jellyfinOrigin}${trimmed}`;
      } else {
        try { absUrl = new URL(trimmed, manifestUrl).toString(); } catch { return line; }
      }
      return `/nas/jellyfin-seg?t=${token}&src=${Buffer.from(absUrl).toString('base64url')}`;
    }).join('\n');
  }

  private signTranscodeToken(nasUrl: string, durationSeconds: number): string {
    const exp = Math.floor(Date.now() / 1000) + 4 * 3600; // 4 hours
    const payload = Buffer.from(JSON.stringify({ url: nasUrl, duration: durationSeconds, exp })).toString('base64url');
    const sig = createHmac('sha256', this.tokenSecret).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }

  /** Jeton court pour fileproxy TV : évite ?t=… > limite proxy (URL NAS avec path long). Résolution côté serveur + SID neuf. */
  private signPassthroughFileToken(
    durationSeconds: number,
    ref: { mediaId?: number; episodeId?: number },
    userId: number,
    cineClubId: number,
  ): string {
    const exp = Math.floor(Date.now() / 1000) + 4 * 3600;
    const payload = Buffer.from(
      JSON.stringify({ ...ref, userId, cineClubId, duration: durationSeconds, exp }),
    ).toString('base64url');
    const sig = createHmac('sha256', this.tokenSecret).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }

  private verifyTranscodeToken(token: string): {
    url?: string;
    duration: number;
    exp: number;
    mediaId?: number;
    episodeId?: number;
    userId?: number;
    cineClubId?: number;
  } | null {
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
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
      url?: string;
      duration: number;
      exp: number;
      mediaId?: number;
      episodeId?: number;
      userId?: number;
      cineClubId?: number;
    };
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof data.duration !== 'number') return null;
    return data;
  }

  private async resolveNasUrlFromStreamToken(data: {
    url?: string;
    duration: number;
    mediaId?: number;
    episodeId?: number;
    userId?: number;
    cineClubId?: number;
  }): Promise<string | null> {
    if (data.url) return data.url;
    if (data.mediaId != null && data.userId != null && data.cineClubId != null) {
      return this.nasService.getMediaFileUrl(data.mediaId, data.userId, data.cineClubId);
    }
    if (data.episodeId != null && data.userId != null && data.cineClubId != null) {
      return this.nasService.getEpisodeFileUrl(data.episodeId, data.userId, data.cineClubId);
    }
    return null;
  }

  // ── Wake-on-LAN ────────────────────────────────────────────────────────────

  @Post('wake')
  @Roles(MemberRole.ADMIN)
  async wake(@Req() req: { user: JwtPayload }) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    await this.nasService.sendWakeOnLan(req.user.cineClubId);
    return { sent: true, message: 'Magic packet envoyé. Le NAS devrait démarrer dans 1 à 3 minutes.' };
  }

  // ── Freebox token ──────────────────────────────────────────────────────────

  @Post('freebox/token')
  @Roles(MemberRole.ADMIN)
  async saveFreeboxToken(
    @Req() req: { user: JwtPayload },
    @Body() body: { freeboxApiUrl: string; appToken: string },
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    await this.nasService.saveFreeboxConfig(req.user.cineClubId, body.freeboxApiUrl, body.appToken);
    return { saved: true };
  }

  @Post('freebox/authorize')
  @Roles(MemberRole.ADMIN)
  async startFreeboxAuthorization(
    @Req() req: { user: JwtPayload },
    @Body() body: { freeboxApiUrl: string },
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    const result = await this.nasService.startFreeboxAuthorization(req.user.cineClubId, body.freeboxApiUrl);
    return { trackId: result.trackId, message: 'Appuyez sur OK sur l\'écran de la Freebox pour autoriser Nasflix' };
  }

  @Get('freebox/authorize/:trackId')
  @Roles(MemberRole.ADMIN)
  async checkFreeboxAuthorizationStatus(
    @Req() req: { user: JwtPayload },
    @Param('trackId') trackId: string,
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    return this.nasService.checkFreeboxAuthorizationStatus(req.user.cineClubId, parseInt(trackId, 10));
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  @Get('status')
  async getStatus(@Req() req: { user: JwtPayload }) {
    if (!req.user.cineClubId) return { online: false, lastCheckedAt: new Date().toISOString() };

    const online = await this.nasService.checkStatusForCineClub(req.user.cineClubId);
    return { online, lastCheckedAt: new Date().toISOString() };
  }

  // ── Jellyfin status ───────────────────────────────────────────────────────────

  @Get('jellyfin/status')
  async getJellyfinStatus(@Req() req: { user: JwtPayload }) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    return this.nasService.checkJellyfinStatus(req.user.cineClubId);
  }

  @Post('jellyfin/config')
  @Roles(MemberRole.ADMIN)
  async saveJellyfinConfig(
    @Req() req: { user: JwtPayload },
    @Body() body: { jellyfinBaseUrl: string; jellyfinApiToken: string },
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    await this.nasService.saveJellyfinConfig(req.user.cineClubId, body.jellyfinBaseUrl, body.jellyfinApiToken);
    return { saved: true };
  }

  // ── Track probing ──────────────────────────────────────────────────────────

  @Get('tracks/episode/:episodeId')
  async getEpisodeTracks(
    @Param('episodeId', ParseIntPipe) episodeId: number,
    @Req() req: { user: JwtPayload },
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    // Si SEEDBOX → Jellyfin PlaybackInfo au lieu de FFmpeg
    const jellyfinTracks = await this.nasService.getEpisodeTracksForJellyfin(episodeId, req.user.cineClubId);
    if (jellyfinTracks) return jellyfinTracks;
    const nasUrl = await this.nasService.getEpisodeFileUrl(episodeId, req.user.sub, req.user.cineClubId);
    return this.nasService.probeMediaTracks(nasUrl);
  }

  @Get('tracks/:mediaId')
  async getMediaTracks(
    @Param('mediaId', ParseIntPipe) mediaId: number,
    @Req() req: { user: JwtPayload },
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    // Si SEEDBOX → Jellyfin PlaybackInfo au lieu de FFmpeg
    const jellyfinTracks = await this.nasService.getMediaTracksForJellyfin(mediaId, req.user.cineClubId);
    if (jellyfinTracks) return jellyfinTracks;
    const nasUrl = await this.nasService.getMediaFileUrl(mediaId, req.user.sub, req.user.cineClubId);
    return this.nasService.probeMediaTracks(nasUrl);
  }

  // ── Stream URLs ────────────────────────────────────────────────────────────

  @Get('stream/episode/:episodeId')
  async getEpisodeStreamUrl(
    @Param('episodeId', ParseIntPipe) episodeId: number,
    @Query('mode') mode: 'stream' | 'download' = 'stream',
    @Query('passthrough') passthrough: string = '0',
    @Query('audioTrack') audioTrackQuery: string = '1',
    @Req() req: { user: JwtPayload },
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    const audioTrack = Math.max(1, parseInt(audioTrackQuery) || 1);

    // passthrough=1 : proxy FileStation direct pour NAS (SSL auto-signé), mais Jellyfin n'en a pas besoin
    const { nasUrl, durationSeconds, isHls, sourceType, jellyfinItemId, jellyfinBaseUrl, jellyfinApiToken } = await this.nasService.getEpisodeStreamUrl(episodeId, req.user.sub, req.user.cineClubId, mode, audioTrack);
    if (passthrough === '1' && sourceType !== 'SEEDBOX') {
      const duration = await this.nasService.getEpisodeDuration(episodeId, req.user.cineClubId);
      const t = this.signPassthroughFileToken(duration, { episodeId }, req.user.sub, req.user.cineClubId);
      this.logger.log(`[stream/episode] passthrough episodeId=${episodeId} token=compact`);
      return { url: `/nas/fileproxy?t=${t}`, isHls: false, durationSeconds: duration };
    }
    this.logger.log(`[stream/episode] mode=${mode} isHls=${isHls} sourceType=${sourceType ?? 'NAS'} episodeId=${episodeId} nasUrl=${nasUrl.slice(0, 80)}`);
    if (mode === 'stream') {
      if (isHls && sourceType === 'SEEDBOX' && jellyfinItemId && jellyfinBaseUrl && jellyfinApiToken) {
        const t = this.signJellyfinProxyToken(jellyfinBaseUrl, jellyfinApiToken, jellyfinItemId, durationSeconds);
        return { url: `/nas/jellyfin-stream?t=${t}`, isHls: true, durationSeconds, sourceType, jellyfinItemId, jellyfinBaseUrl, jellyfinApiToken };
      }
      if (isHls) return { url: nasUrl, isHls: true, durationSeconds, sourceType, jellyfinItemId, jellyfinBaseUrl, jellyfinApiToken };
      return { url: `/nas/transcode?t=${this.signTranscodeToken(nasUrl, durationSeconds)}`, isHls: false, durationSeconds };
    }
    // download : Jellyfin direct (certificat valide), NAS via proxy Railway
    if (sourceType === 'SEEDBOX') return { url: nasUrl, isHls: false, durationSeconds };
    return { url: `/nas/fileproxy?download=1&t=${this.signTranscodeToken(nasUrl, durationSeconds)}`, isHls: false, durationSeconds };
  }

  @Get('stream/:mediaId')
  async getStreamUrl(
    @Param('mediaId', ParseIntPipe) mediaId: number,
    @Query('mode') mode: 'stream' | 'download' = 'stream',
    @Query('passthrough') passthrough: string = '0',
    @Query('audioTrack') audioTrackQuery: string = '1',
    @Req() req: { user: JwtPayload },
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    const audioTrack = Math.max(1, parseInt(audioTrackQuery) || 1);

    // passthrough=1 : proxy FileStation direct pour NAS (SSL auto-signé), mais Jellyfin n'en a pas besoin
    const { nasUrl, durationSeconds, isHls, sourceType, jellyfinItemId, jellyfinBaseUrl, jellyfinApiToken } = await this.nasService.getStreamUrl(mediaId, req.user.sub, req.user.cineClubId, mode, audioTrack);
    if (passthrough === '1' && sourceType !== 'SEEDBOX') {
      const media = await this.nasService.getMediaDuration(mediaId, req.user.cineClubId);
      const t = this.signPassthroughFileToken(media, { mediaId }, req.user.sub, req.user.cineClubId);
      this.logger.log(`[stream/media] passthrough mediaId=${mediaId} token=compact`);
      return { url: `/nas/fileproxy?t=${t}`, isHls: false, durationSeconds: media };
    }
    this.logger.log(`[stream/media] mode=${mode} isHls=${isHls} sourceType=${sourceType ?? 'NAS'} mediaId=${mediaId} nasUrl=${nasUrl.slice(0, 80)}`);
    if (mode === 'stream') {
      if (isHls && sourceType === 'SEEDBOX' && jellyfinItemId && jellyfinBaseUrl && jellyfinApiToken) {
        const t = this.signJellyfinProxyToken(jellyfinBaseUrl, jellyfinApiToken, jellyfinItemId, durationSeconds);
        return { url: `/nas/jellyfin-stream?t=${t}`, isHls: true, durationSeconds, sourceType, jellyfinItemId, jellyfinBaseUrl, jellyfinApiToken };
      }
      if (isHls) return { url: nasUrl, isHls: true, durationSeconds, sourceType, jellyfinItemId, jellyfinBaseUrl, jellyfinApiToken };
      return { url: `/nas/transcode?t=${this.signTranscodeToken(nasUrl, durationSeconds)}`, isHls: false, durationSeconds };
    }
    // download : Jellyfin direct (certificat valide), NAS via proxy Railway
    if (sourceType === 'SEEDBOX') return { url: nasUrl, isHls: false, durationSeconds };
    return { url: `/nas/fileproxy?download=1&t=${this.signTranscodeToken(nasUrl, durationSeconds)}`, isHls: false, durationSeconds };
  }

  // ── Jellyfin HLS proxy (CORS bypass) ─────────────────────────────────────

  @Get('jellyfin-stream')
  @Public()
  async jellyfinStream(
    @Query('t') token: string,
    @Query('AudioStreamIndex') audioStreamIndex: string = '1',
    @Res() res: Response,
  ) {
    const data = this.verifyJellyfinProxyToken(token);
    if (!data) { res.status(403).end(); return; }

    const base = data.base.replace(/\/$/, '');
    const params = new URLSearchParams({
      api_key: data.key,
      VideoCodec: 'copy',
      AudioCodec: 'copy',
      Container: 'ts',
      TranscodingContainer: 'ts',
      SegmentContainer: 'ts',
      MinSegments: '1',
      DeviceId: 'nasflix',
      static: 'false',
      AudioStreamIndex: audioStreamIndex,
    });
    const manifestUrl = `${base}/Videos/${data.item}/master.m3u8?${params.toString()}`;

    try {
      const manifestRes = await fetch(manifestUrl, { signal: AbortSignal.timeout(15000) });
      if (!manifestRes.ok) {
        this.logger.warn(`[jellyfin-stream] Jellyfin returned ${manifestRes.status} for ${manifestUrl.slice(0, 80)}`);
        res.status(502).end(); return;
      }
      const jellyfinOrigin = new URL(base).origin;
      const manifest = await manifestRes.text();
      const rewritten = this.rewriteJellyfinManifest(manifest, manifestUrl, jellyfinOrigin, token);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(rewritten);
    } catch (err) {
      this.logger.error(`[jellyfin-stream] ${err}`);
      if (!res.headersSent) res.status(502).end();
    }
  }

  @Get('jellyfin-seg')
  @Public()
  async jellyfinSegment(
    @Query('t') token: string,
    @Query('src') src: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const data = this.verifyJellyfinProxyToken(token);
    if (!data) { res.status(403).end(); return; }

    let segUrl: string;
    try { segUrl = Buffer.from(src, 'base64url').toString('utf-8'); } catch { res.status(400).end(); return; }

    // Security: only proxy URLs from the authorised Jellyfin server
    const jellyfinOrigin = new URL(data.base).origin;
    if (!segUrl.startsWith(jellyfinOrigin)) { res.status(403).end(); return; }

    // Ensure api_key is present
    const segWithAuth = segUrl.includes('api_key=')
      ? segUrl
      : `${segUrl}${segUrl.includes('?') ? '&' : '?'}api_key=${data.key}`;

    const reqHeaders: Record<string, string> = {};
    const rangeHeader = (req.headers as Record<string, string>)['range'];
    if (rangeHeader) reqHeaders['Range'] = rangeHeader;

    try {
      const segRes = await fetch(segWithAuth, { headers: reqHeaders, signal: AbortSignal.timeout(30000) });
      if (!segRes.ok) { res.status(502).end(); return; }

      const contentType = segRes.headers.get('content-type') || '';
      const isManifest = contentType.includes('mpegurl') || segUrl.includes('.m3u8');

      if (isManifest) {
        // Recursively rewrite sub-manifest URLs too
        const manifest = await segRes.text();
        const rewritten = this.rewriteJellyfinManifest(manifest, segWithAuth, jellyfinOrigin, token);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(rewritten);
        return;
      }

      // Binary segment — pipe through
      res.status(segRes.status);
      if (contentType) res.setHeader('Content-Type', contentType);
      const cl = segRes.headers.get('content-length');
      if (cl) res.setHeader('Content-Length', cl);
      const cr = segRes.headers.get('content-range');
      if (cr) res.setHeader('Content-Range', cr);
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Access-Control-Allow-Origin', '*');
      const { Readable } = await import('node:stream');
      Readable.fromWeb(segRes.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
    } catch (err) {
      this.logger.error(`[jellyfin-seg] ${err}`);
      if (!res.headersSent) res.status(502).end();
    }
  }

  // ── FileStation proxy (TV passthrough + download, bypass NAS SSL cert) ────

  @Get('fileproxy')
  @Public()
  async fileProxy(
    @Query('t') token: string,
    @Query('download') download: string = '0',
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const data = this.verifyTranscodeToken(token);
    if (!data) { res.status(403).end(); return; }

    const nasUrl = await this.resolveNasUrlFromStreamToken(data);
    if (!nasUrl) { res.status(403).end(); return; }

    const refLabel =
      data.mediaId != null ? `mediaId=${data.mediaId}` :
      data.episodeId != null ? `episodeId=${data.episodeId}` :
      'legacy-url';

    const parsed = new URL(nasUrl);
    const isHttps = parsed.protocol === 'https:';

    let decodedFsPath = '';
    try {
      const raw = parsed.searchParams.get('path');
      const arr = JSON.parse(raw ?? '[]') as unknown;
      decodedFsPath = Array.isArray(arr) && typeof arr[0] === 'string' ? arr[0] : '';
    } catch { /* ignore */ }

    // Build headers — only include Range when actually provided by client
    const reqHeaders: Record<string, string> = {};
    const rangeHeader = (req.headers as Record<string, string>)['range'];
    if (rangeHeader) reqHeaders['Range'] = rangeHeader;
    // Certains DSM / reverse proxy refusent les requêtes « sans navigateur » ; le cookie id= peut entrer en conflit avec sid en query
    reqHeaders['User-Agent'] = 'Mozilla/5.0 (compatible; Nasflix/1.0)';
    reqHeaders['Accept'] = '*/*';

    const fullPath = parsed.pathname + parsed.search;
    this.logger.log(
      `[fileproxy] GET ${refLabel} download=${download === '1'} nasHost=${parsed.hostname}:${parsed.port} decodedPath=${decodedFsPath.slice(0, 280)}${decodedFsPath.length > 280 ? '…' : ''} range=${rangeHeader ?? 'none'} queryChars=${fullPath.length}`,
    );

    const options = {
      hostname: parsed.hostname,
      port: Number(parsed.port) || (isHttps ? 443 : 80),
      path: fullPath,
      method: 'GET',
      headers: reqHeaders,
      rejectUnauthorized: false,
    };

    const sendError = (code: number, reason?: string) => {
      this.logger.warn(`[fileproxy] error ${code}${reason ? ' — ' + reason : ''}`);
      if (!res.headersSent) res.status(code).end();
      else res.destroy();
    };

    const lib = isHttps ? require('node:https') : require('node:http');
    const proxyReq = lib.request(options, (proxyRes: import('http').IncomingMessage) => {
      const status = proxyRes.statusCode ?? 200;
      this.logger.log(`[fileproxy] NAS responded ${status} content-type=${proxyRes.headers['content-type']} content-length=${proxyRes.headers['content-length']} location=${proxyRes.headers['location'] ?? '-'}`);

      // NAS redirect = session SID expired → never forward to browser (SSL cert on NAS)
      if (status >= 300 && status < 400) {
        this.logger.warn(`[fileproxy] NAS redirect to ${proxyRes.headers['location']} — SID probablement expiré`);
        proxyRes.resume(); // drain the body
        sendError(401, 'NAS session expirée, recharge la page et réessaie');
        return;
      }

      // Non-2xx from NAS — read and log response body for diagnosis
      if (status >= 400) {
        const chunks: Buffer[] = [];
        proxyRes.on('data', (c: Buffer) => { if (chunks.reduce((s, b) => s + b.length, 0) < 1000) chunks.push(c); });
        proxyRes.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8').slice(0, 500).replace(/\s+/g, ' ');
          this.logger.warn(`[fileproxy] NAS ${status} body: ${body}`);
        });
        sendError(502, `NAS returned ${status}`);
        return;
      }

      res.status(status);
      const forward = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
      for (const h of forward) {
        const v = proxyRes.headers[h];
        if (v) res.setHeader(h, v as string);
      }
      res.setHeader('Cache-Control', 'no-cache');
      if (download === '1') {
        const rawName = decodedFsPath ? basename(decodedFsPath) : (nasUrl.split('/').pop()?.split('?')[0] ?? 'video');
        let filename = rawName;
        try {
          filename = decodeURIComponent(rawName);
        } catch { /* garde rawName */ }
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        this.logger.log(`[fileproxy] download filename="${filename}"`);
      }
      proxyRes.on('error', (e) => sendError(502, `proxyRes error: ${e.message}`));
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (e: Error) => sendError(502, `proxyReq error: ${e.message}`));
    // 0 = pas de timeout socket (flux longs + requêtes Range ; évite 504 pendant la lecture)
    proxyReq.setTimeout(0);
    proxyReq.end();
  }

  // ── FFmpeg transcode proxy ─────────────────────────────────────────────────

  @Get('transcode')
  @Public()
  async transcode(
    @Query('t') token: string,
    @Query('seek') seekStr: string = '0',
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const data = this.verifyTranscodeToken(token);
    if (!data?.url) { res.status(403).end(); return; }
    const nasSourceUrl = data.url;

    const seek = Math.max(0, parseInt(seekStr) || 0);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-cache');
    if (data.duration > 0) {
      res.setHeader('X-Duration', String(data.duration));
    }

    // Try FFmpeg with direct NAS URL first (fast seek with -ss).
    // Falls back to stdin pipe if FFmpeg can't open the URL.
    const ffmpegArgs = [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-tls_verify', '0',
      ...(seek > 0 ? ['-ss', String(seek)] : []),
      '-i', nasSourceUrl,
      '-map', '0:v:0',
      '-map', '0:a:0',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      '-vf', 'scale=-2:min(ih\\,1080)',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ac', '2',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov',
      'pipe:1',
    ];

    const ffmpeg = spawn(ffmpegPath, ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

    // If FFmpeg fails to open the URL, fall back to stdin pipe
    let directUrlFailed = false;
    let stdinFallbackStarted = false;

    const startStdinFallback = async () => {
      if (stdinFallbackStarted || res.headersSent && res.writableEnded) return;
      stdinFallbackStarted = true;
      this.logger.warn('[FFmpeg] Direct URL failed, falling back to stdin pipe');

      const { Readable } = await import('node:stream');
      const abort = new AbortController();
      const nasRes = await fetch(nasSourceUrl, { signal: abort.signal }).catch(() => null);
      if (!nasRes?.ok || !nasRes.body) { if (!res.headersSent) res.status(502).end(); return; }

      const fallbackArgs = [
        ...(seek > 0 ? ['-ss', String(seek)] : []),
        '-i', 'pipe:0',
        '-map', '0:v:0', '-map', '0:a:0',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
        '-vf', 'scale=-2:min(ih\\,1080)',
        '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
        '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov',
        'pipe:1',
      ];
      const fb = spawn(ffmpegPath, fallbackArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
      const nasReadable = Readable.fromWeb(nasRes.body as Parameters<typeof Readable.fromWeb>[0]);
      nasReadable.on('error', () => {});
      fb.stdin?.on('error', () => {});
      nasReadable.pipe(fb.stdin!);
      req.on('close', () => { fb.kill('SIGKILL'); nasReadable.destroy(); abort.abort(); });
      fb.stderr?.on('data', (c: Buffer) => this.logger.debug(`[FFmpeg-fb] ${c.toString().trim()}`));
      fb.stdout?.pipe(res);
    };

    // Detect if FFmpeg can't open the URL (5s timeout with no output)
    const urlTimeout = setTimeout(() => {
      if (!directUrlFailed && !res.writableEnded) {
        directUrlFailed = true;
        ffmpeg.kill('SIGKILL');
        startStdinFallback();
      }
    }, 5000);

    ffmpeg.stdout?.once('data', () => clearTimeout(urlTimeout));

    req.on('close', () => {
      clearTimeout(urlTimeout);
      ffmpeg.kill('SIGKILL');
    });

    ffmpeg.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim();
      this.logger.debug(`[FFmpeg] ${line}`);
      // Detect connection errors → trigger fallback immediately
      if (!directUrlFailed && (line.includes('Connection refused') || line.includes('Network unreachable') || line.includes('No such file'))) {
        directUrlFailed = true;
        clearTimeout(urlTimeout);
        ffmpeg.kill('SIGKILL');
        startStdinFallback();
      }
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
