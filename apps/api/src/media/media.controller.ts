import { Controller, Get, Delete, Patch, Param, Query, ParseIntPipe, Body } from '@nestjs/common';
import { MediaService } from './media.service';
import { Public } from '../auth/guards/public.decorator';
import { MediaType } from '@prisma/client';

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
    @Body() data: { titleVf?: string; overview?: string; tmdbId?: number },
  ) {
    return this.mediaService.update(id, data);
  }
}
