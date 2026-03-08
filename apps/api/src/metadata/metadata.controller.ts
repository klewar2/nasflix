import { Controller, Get, Put, Body, Query } from '@nestjs/common';
import { MetadataService } from './metadata.service';
import { Public } from '../auth/guards/public.decorator';

@Controller('metadata')
export class MetadataController {
  constructor(private metadataService: MetadataService) {}

  @Get('search')
  async search(@Query('q') query: string, @Query('year') year?: number) {
    return this.metadataService.searchMulti(query, year);
  }

  @Get('config')
  async getConfigs() {
    return this.metadataService.getApiConfigs();
  }

  @Put('config')
  async updateConfig(@Body() data: { provider: string; apiKey: string; baseUrl?: string }) {
    return this.metadataService.updateApiConfig(data.provider, data.apiKey, data.baseUrl);
  }
}
