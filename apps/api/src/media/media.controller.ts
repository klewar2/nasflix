import { Controller, Get, Delete, Patch, Param, Query, ParseIntPipe, Body, Req, ForbiddenException, UseGuards, DefaultValuePipe } from '@nestjs/common';
import { MediaService } from './media.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { MemberRole, MediaType, SyncStatus } from '@prisma/client';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get()
  findAll(
    @Query('type') type: MediaType | undefined,
    @Query('genreId', new DefaultValuePipe(undefined), new ParseIntPipe({ optional: true })) genreId: number | undefined,
    @Query('year', new DefaultValuePipe(undefined), new ParseIntPipe({ optional: true })) year: number | undefined,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Req() req: { user: JwtPayload },
  ) {
    const cineClubId = this.requireCineClub(req.user);
    return this.mediaService.findAll({ cineClubId, type, genreId, year, page, limit });
  }

  @Get('search')
  search(
    @Query('q') query: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Req() req: { user: JwtPayload },
  ) {
    const cineClubId = this.requireCineClub(req.user);
    return this.mediaService.search(query, cineClubId, page, limit);
  }

  @Get('recent')
  findRecent(
    @Query('limit', new DefaultValuePipe(40), ParseIntPipe) limit: number,
    @Req() req: { user: JwtPayload },
  ) {
    const cineClubId = this.requireCineClub(req.user);
    return this.mediaService.findRecent(cineClubId, limit);
  }

  @Get('unsynchronized')
  findUnsynchronized(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Req() req: { user: JwtPayload },
  ) {
    const cineClubId = this.requireCineClub(req.user);
    return this.mediaService.findUnsynchronized(cineClubId, page, limit);
  }

  @Get('genres')
  getGenres(@Req() req: { user: JwtPayload }) {
    const cineClubId = this.requireCineClub(req.user);
    return this.mediaService.getGenres(cineClubId);
  }

  @Get('quality/:type')
  findByQuality(
    @Param('type') type: 'UHD' | 'HDR' | 'FHD',
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Req() req: { user: JwtPayload },
  ) {
    const cineClubId = this.requireCineClub(req.user);
    return this.mediaService.findByQuality(type, cineClubId, limit);
  }

  @UseGuards(RolesGuard)
  @Get('admin/list')
  findAllAdmin(
    @Query('type') type: MediaType | undefined,
    @Query('status') status: SyncStatus | undefined,
    @Query('title') title: string | undefined,
    @Query('videoQuality') videoQuality: string | undefined,
    @Query('dolbyVision') dolbyVision: string | undefined,
    @Query('hdr') hdr: string | undefined,
    @Query('dolbyAtmos') dolbyAtmos: string | undefined,
    @Query('sortBy') sortBy: string | undefined,
    @Query('sortOrder') sortOrder: 'asc' | 'desc' | undefined,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Req() req: { user: JwtPayload },
  ) {
    const cineClubId = this.requireCineClub(req.user);
    return this.mediaService.findAllAdmin({
      cineClubId, type, status, title, videoQuality,
      dolbyVision: dolbyVision === 'true',
      hdr: hdr === 'true',
      dolbyAtmos: dolbyAtmos === 'true',
      sortBy, sortOrder, page, limit,
    });
  }

  @Get(':id')
  findById(@Param('id', ParseIntPipe) id: number, @Req() req: { user: JwtPayload }) {
    const cineClubId = this.requireCineClub(req.user);
    return this.mediaService.findById(id, cineClubId);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRole.ADMIN)
  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number, @Req() req: { user: JwtPayload }) {
    const cineClubId = this.requireCineClub(req.user);
    return this.mediaService.delete(id, cineClubId);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRole.ADMIN)
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: { titleVf?: string; titleOriginal?: string; overview?: string; tmdbId?: number; releaseYear?: number; syncStatus?: SyncStatus; syncError?: string | null },
    @Req() req: { user: JwtPayload },
  ) {
    const cineClubId = this.requireCineClub(req.user);
    return this.mediaService.update(id, cineClubId, data);
  }

  private requireCineClub(user: JwtPayload): number {
    if (!user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    return user.cineClubId;
  }
}
