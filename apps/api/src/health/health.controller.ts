import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { NasService } from '../nas/nas.service';
import { Public } from '../auth/guards/public.decorator';

@Controller('health')
export class HealthController {
  constructor(
    private prisma: PrismaService,
    private nasService: NasService,
  ) {}

  @Public()
  @Get()
  async check() {
    let dbStatus: 'ok' | 'error' = 'ok';
    let nasStatus: 'online' | 'offline' | 'unknown' = 'unknown';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'error';
    }

    try {
      nasStatus = (await this.nasService.checkStatus()) ? 'online' : 'offline';
    } catch {
      nasStatus = 'unknown';
    }

    return {
      status: dbStatus === 'ok' ? 'ok' : 'error',
      nas: nasStatus,
      db: dbStatus,
      timestamp: new Date().toISOString(),
    };
  }
}
