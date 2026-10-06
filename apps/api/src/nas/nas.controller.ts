import { Body, Controller, ForbiddenException, Get, Logger, Param, ParseIntPipe, Post, Query, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { NasService } from './nas.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { MemberRole } from '@prisma/client';
import {
  SaveFreeboxTokenDto,
  StartFreeboxAuthorizationDto,
  SaveJellyfinConfigDto,
} from './dto/freebox.dto';

@Controller('nas')
@UseGuards(RolesGuard)
export class NasController {
  private readonly logger = new Logger(NasController.name);

  constructor(private readonly nasService: NasService) {}

  // ── Wake-on-LAN ────────────────────────────────────────────────────────────

  @Post('wake')
  async wake(@Req() req: { user: JwtPayload }) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    const result = await this.nasService.sendWakeOnLan(req.user.cineClubId, req.user.sub);
    if (result.alreadyInProgress) {
      return { sent: false, alreadyInProgress: true, message: 'Un démarrage du NAS est déjà en cours.' };
    }
    return { sent: true, alreadyInProgress: false, message: 'Magic packet envoyé. Le NAS devrait démarrer dans 1 à 3 minutes.' };
  }

  // ── Freebox token ──────────────────────────────────────────────────────────

  @Post('freebox/token')
  @Roles(MemberRole.ADMIN)
  async saveFreeboxToken(
    @Req() req: { user: JwtPayload },
    @Body() dto: SaveFreeboxTokenDto,
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    await this.nasService.saveFreeboxConfig(req.user.cineClubId, dto.freeboxApiUrl, dto.appToken);
    return { saved: true };
  }

  @Post('freebox/authorize')
  @Roles(MemberRole.ADMIN)
  async startFreeboxAuthorization(
    @Req() req: { user: JwtPayload },
    @Body() dto: StartFreeboxAuthorizationDto,
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    const result = await this.nasService.startFreeboxAuthorization(req.user.cineClubId, dto.freeboxApiUrl);
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
    if (!req.user.cineClubId) {
      return {
        online: false,
        lastCheckedAt: new Date().toISOString(),
        wakeInProgress: false,
        wakeStartedAt: null,
        wakeStartedByUserId: null,
        wakeTimeoutSeconds: 300,
      };
    }

    const status = await this.nasService.getNasStatusForCineClub(req.user.cineClubId);
    return { ...status, lastCheckedAt: new Date().toISOString() };
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
    @Body() dto: SaveJellyfinConfigDto,
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    await this.nasService.saveJellyfinConfig(req.user.cineClubId, dto.jellyfinBaseUrl, dto.jellyfinApiToken);
    return { saved: true };
  }

  // ── NAS subtitle cache (extraction VTT d'une piste à la demande) ────────────

  @Get('subtitles/episode/:episodeId/track/:trackIdx')
  async getEpisodeSubtitleTrack(
    @Param('episodeId', ParseIntPipe) episodeId: number,
    @Param('trackIdx', ParseIntPipe) trackIdx: number,
    @Query('lang') lang: string | undefined,
    @Query('title') title: string | undefined,
    @Query('codec') codec: string | undefined,
    @Req() req: { user: JwtPayload },
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    return this.nasService.getNasSubtitleTrackForEpisode(episodeId, trackIdx, req.user.sub, req.user.cineClubId, { language: lang, title, codec });
  }

  @Get('subtitles/:mediaId/track/:trackIdx')
  async getMediaSubtitleTrack(
    @Param('mediaId', ParseIntPipe) mediaId: number,
    @Param('trackIdx', ParseIntPipe) trackIdx: number,
    @Query('lang') lang: string | undefined,
    @Query('title') title: string | undefined,
    @Query('codec') codec: string | undefined,
    @Req() req: { user: JwtPayload },
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    return this.nasService.getNasSubtitleTrackForMedia(mediaId, trackIdx, req.user.sub, req.user.cineClubId, { language: lang, title, codec });
  }

  // ── Sous-titres image (PGS) : état d'extraction puis téléchargement du .sup ──
  // Rendus en image par l'app TV (libpgs). Le .sup transite par l'API (quelques Mo),
  // jamais la vidéo.

  @Get('subtitles/episode/:episodeId/image/:trackIdx')
  async getEpisodeImageSubtitle(
    @Param('episodeId', ParseIntPipe) episodeId: number,
    @Param('trackIdx', ParseIntPipe) trackIdx: number,
    @Query('lang') lang: string | undefined,
    @Query('codec') codec: string | undefined,
    @Req() req: { user: JwtPayload },
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    return this.nasService.getNasImageSubtitleForEpisode(episodeId, trackIdx, req.user.cineClubId, { language: lang, codec });
  }

  @Get('subtitles/episode/:episodeId/image/:trackIdx/data')
  async getEpisodeImageSubtitleData(
    @Param('episodeId', ParseIntPipe) episodeId: number,
    @Param('trackIdx', ParseIntPipe) trackIdx: number,
    @Req() req: { user: JwtPayload },
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    const data = await this.nasService.getNasImageSubtitleDataForEpisode(episodeId, trackIdx, req.user.cineClubId);
    return new StreamableFile(data, { type: 'application/octet-stream', length: data.length });
  }

  @Get('subtitles/:mediaId/image/:trackIdx')
  async getMediaImageSubtitle(
    @Param('mediaId', ParseIntPipe) mediaId: number,
    @Param('trackIdx', ParseIntPipe) trackIdx: number,
    @Query('lang') lang: string | undefined,
    @Query('codec') codec: string | undefined,
    @Req() req: { user: JwtPayload },
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    return this.nasService.getNasImageSubtitleForMedia(mediaId, trackIdx, req.user.cineClubId, { language: lang, codec });
  }

  @Get('subtitles/:mediaId/image/:trackIdx/data')
  async getMediaImageSubtitleData(
    @Param('mediaId', ParseIntPipe) mediaId: number,
    @Param('trackIdx', ParseIntPipe) trackIdx: number,
    @Req() req: { user: JwtPayload },
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    const data = await this.nasService.getNasImageSubtitleDataForMedia(mediaId, trackIdx, req.user.cineClubId);
    return new StreamableFile(data, { type: 'application/octet-stream', length: data.length });
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
    const tracks = await this.nasService.probeMediaTracks(nasUrl);
    // Pré-extraction de tous les sous-titres en arrière-plan pendant le chargement de la vidéo
    // (best-effort, ne lève jamais) : l'extraction à la demande reste le filet de sécurité.
    void this.nasService.prefetchSubtitlesForEpisode(episodeId, req.user.cineClubId, tracks.subtitles);
    return tracks;
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
    const tracks = await this.nasService.probeMediaTracks(nasUrl);
    void this.nasService.prefetchSubtitlesForMedia(mediaId, req.user.cineClubId, tracks.subtitles);
    return tracks;
  }

  // ── Stream URLs ────────────────────────────────────────────────────────────
  // Toutes les URLs renvoyées sont directes (FileStation ou Jellyfin) : la vidéo
  // ne transite jamais par Railway (égress facturé).
  // - stream (app TV uniquement, source NAS) → FileStation mode=open (direct play)
  // - download (web) → FileStation mode=download / Jellyfin /Items/…/Download

  @Get('stream/episode/:episodeId')
  async getEpisodeStreamUrl(
    @Param('episodeId', ParseIntPipe) episodeId: number,
    @Query('mode') mode: 'stream' | 'download' = 'stream',
    @Query('client') clientQuery: string = 'web',
    @Req() req: { user: JwtPayload },
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    const clientType = clientQuery === 'tv' ? 'tv' : 'web';
    const { nasUrl, durationSeconds, isHls, sourceType } =
      await this.nasService.getEpisodeStreamUrl(episodeId, req.user.sub, req.user.cineClubId, mode, clientType);
    this.logger.log(`[stream] mode=${mode} client=${clientType} episodeId=${episodeId} → direct ${new URL(nasUrl).host}`);
    // sourceType est indispensable côté TV : sans lui, useVideoTracks ne déclenche
    // jamais le préchargement ni le chargement des sous-titres NAS.
    return { url: nasUrl, isHls, durationSeconds, sourceType };
  }

  @Get('stream/:mediaId')
  async getStreamUrl(
    @Param('mediaId', ParseIntPipe) mediaId: number,
    @Query('mode') mode: 'stream' | 'download' = 'stream',
    @Query('client') clientQuery: string = 'web',
    @Req() req: { user: JwtPayload },
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    const clientType = clientQuery === 'tv' ? 'tv' : 'web';
    const { nasUrl, durationSeconds, isHls, sourceType } =
      await this.nasService.getStreamUrl(mediaId, req.user.sub, req.user.cineClubId, mode, clientType);
    this.logger.log(`[stream] mode=${mode} client=${clientType} mediaId=${mediaId} → direct ${new URL(nasUrl).host}`);
    return { url: nasUrl, isHls, durationSeconds, sourceType };
  }
}
