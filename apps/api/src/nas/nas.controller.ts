import { Controller, Get, Put, Body } from '@nestjs/common';
import { NasService } from './nas.service';
import { Public } from '../auth/guards/public.decorator';

@Controller('nas')
export class NasController {
  constructor(private nasService: NasService) {}

  @Public()
  @Get('status')
  async getStatus() {
    const online = await this.nasService.checkStatus();
    return {
      online,
      lastCheckedAt: new Date().toISOString(),
    };
  }

  @Get('config')
  async getConfig() {
    return this.nasService.getNasConfig();
  }

  @Put('config')
  async updateConfig(
    @Body() data: { baseUrl?: string; username?: string; password?: string; sharedFolders?: string[] },
  ) {
    return this.nasService.updateConfig(data);
  }

  @Get('files')
  async listFiles() {
    return this.nasService.listAllVideoFiles();
  }
}
