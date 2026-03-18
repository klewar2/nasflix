import { Controller, Get, Query, Req, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { MetadataService } from './metadata.service';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

@Controller('metadata')
export class MetadataController {
  constructor(private readonly metadataService: MetadataService) {}

  @Get('search')
  search(
    @Query('q') query: string,
    @Query('year', new DefaultValuePipe(undefined), new ParseIntPipe({ optional: true })) year: number | undefined,
    @Req() req: { user: JwtPayload },
  ) {
    return this.metadataService.searchMulti(query, year, req.user.cineClubId);
  }
}
