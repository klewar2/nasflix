import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Public } from '../auth/guards/public.decorator';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get()
  async check() {
    let dbStatus: 'ok' | 'error' = 'ok';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'error';
    }

    return {
      status: dbStatus === 'ok' ? 'ok' : 'error',
      nas: 'unknown',
      db: dbStatus,
      timestamp: new Date().toISOString(),
    };
  }
}
