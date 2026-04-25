import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Public } from '../auth/guards/public.decorator';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    let dbStatus: 'ok' | 'error' = 'ok';
    let nasStatus: 'ok' | 'offline' | 'unknown' = 'unknown';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'error';
    }

    if (dbStatus === 'ok') {
      try {
        const clubs = await this.prisma.cineClub.findMany({
          where: { nasBaseUrl: { not: null } },
          select: { nasBaseUrl: true },
          take: 3,
        });
        const urls = clubs.map((c) => c.nasBaseUrl).filter(Boolean) as string[];
        if (urls.length === 0) {
          nasStatus = 'unknown';
        } else {
          const results = await Promise.all(
            urls.map((url) =>
              fetch(`${url}/webapi/query.cgi`, { signal: AbortSignal.timeout(3000) })
                .then(() => true)
                .catch(() => false),
            ),
          );
          nasStatus = results.some(Boolean) ? 'ok' : 'offline';
        }
      } catch {
        nasStatus = 'unknown';
      }
    }

    return {
      status: dbStatus === 'ok' ? 'ok' : 'error',
      nas: nasStatus,
      db: dbStatus,
      timestamp: new Date().toISOString(),
    };
  }
}
