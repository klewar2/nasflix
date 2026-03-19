import { Controller, ForbiddenException, Get, Param, ParseIntPipe, Query, Req, UseGuards } from '@nestjs/common';
import { NasService } from './nas.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

@Controller('nas')
@UseGuards(RolesGuard)
export class NasController {
  constructor(private readonly nasService: NasService) {}

  @Get('status')
  async getStatus(@Req() req: { user: JwtPayload }) {
    if (!req.user.cineClubId) return { online: false, lastCheckedAt: new Date().toISOString() };

    const online = await this.nasService.checkStatusForCineClub(req.user.cineClubId);
    return { online, lastCheckedAt: new Date().toISOString() };
  }

  @Get('stream/episode/:episodeId')
  async getEpisodeStreamUrl(
    @Param('episodeId', ParseIntPipe) episodeId: number,
    @Query('mode') mode: 'stream' | 'download' = 'stream',
    @Req() req: { user: JwtPayload },
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    return this.nasService.getEpisodeStreamUrl(episodeId, req.user.sub, req.user.cineClubId, mode);
  }

  @Get('stream/:mediaId')
  async getStreamUrl(
    @Param('mediaId', ParseIntPipe) mediaId: number,
    @Query('mode') mode: 'stream' | 'download' = 'stream',
    @Req() req: { user: JwtPayload },
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    return this.nasService.getStreamUrl(mediaId, req.user.sub, req.user.cineClubId, mode);
  }
}
