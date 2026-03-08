import { Controller, Get, Delete, Patch, Param, Query, ParseIntPipe, Body } from '@nestjs/common';
import { MediaService } from './media.service';
import { Public } from '../auth/guards/public.decorator';
import { MediaType, SyncStatus } from '@prisma/client';

@Controller('media')
export class MediaController {
  constructor(private mediaService: MediaService) {}

  @Public()
  @Get()
  findAll(
    @Query('type') type?: MediaType,
    @Query('genreId') genreId?: number,
    @Query('year') year?: number,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.mediaService.findAll({ type, genreId, year, page, limit });
  }

  @Public()
  @Get('search')
  search(
    @Query('q') query: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.mediaService.search(query, page, limit);
  }

  @Public()
  @Get('recent')
  findRecent(@Query('limit') limit?: number) {
    return this.mediaService.findRecent(limit);
  }

  @Public()
  @Get('unsynchronized')
  findUnsynchronized(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.mediaService.findUnsynchronized(page, limit);
  }

  @Public()
  @Get('genres')
  getGenres() {
    return this.mediaService.getGenres();
  }

  @Public()
  @Get('quality/:type')
  findByQuality(
    @Param('type') type: 'UHD' | 'HDR' | 'FHD',
    @Query('limit') limit?: number,
  ) {
    return this.mediaService.findByQuality(type, limit);
  }

  @Get('admin/list')
  findAllAdmin(
    @Query('type') type?: MediaType,
    @Query('status') status?: SyncStatus,
    @Query('title') title?: string,
    @Query('videoQuality') videoQuality?: string,
    @Query('dolbyVision') dolbyVision?: string,
    @Query('hdr') hdr?: string,
    @Query('dolbyAtmos') dolbyAtmos?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.mediaService.findAllAdmin({
      type, status, title, videoQuality,
      dolbyVision: dolbyVision === 'true',
      hdr: hdr === 'true',
      dolbyAtmos: dolbyAtmos === 'true',
      sortBy, sortOrder, page, limit,
    });
  }

  @Public()
  @Get(':id')
  findById(@Param('id', ParseIntPipe) id: number) {
    return this.mediaService.findById(id);
  }

  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.mediaService.delete(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: { titleVf?: string; titleOriginal?: string; overview?: string; tmdbId?: number; releaseYear?: number; syncStatus?: SyncStatus; syncError?: string | null },
  ) {
    return this.mediaService.update(id, data);
  }
}
