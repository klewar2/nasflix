import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

const JOBS_RETENTION_DAYS = 30;
const RECOMMENDATIONS_RETENTION_DAYS = 60;

@Injectable()
export class JobsCleanupService {
  private readonly logger = new Logger(JobsCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Quotidien 03:00 — purge l'historique des Jobs terminés > 30j et les vieilles recos. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runCleanup() {
    await this.cleanupJobs();
    await this.cleanupRecommendations();
  }

  async cleanupJobs(): Promise<number> {
    const cutoff = new Date(Date.now() - JOBS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const result = await this.prisma.job.deleteMany({
      where: {
        status: { in: [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED] },
        OR: [
          { completedAt: { lt: cutoff } },
          { completedAt: null, createdAt: { lt: cutoff } },
        ],
      },
    });
    this.logger.log(`[cleanup] ${result.count} jobs supprimés (>${JOBS_RETENTION_DAYS}j)`);
    return result.count;
  }

  async cleanupRecommendations(): Promise<number> {
    const cutoff = new Date(Date.now() - RECOMMENDATIONS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const result = await this.prisma.recommendation.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    this.logger.log(`[cleanup] ${result.count} recommandations supprimées (>${RECOMMENDATIONS_RETENTION_DAYS}j)`);
    return result.count;
  }
}
