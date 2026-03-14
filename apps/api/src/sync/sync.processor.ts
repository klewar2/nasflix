import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SyncService } from './sync.service';
import { SyncGateway } from './sync.gateway';
import { METADATA_SYNC_QUEUE } from './sync.constants';
import { PrismaService } from '../common/prisma.service';

export interface MetadataSyncJobData {
  mediaId: number;
}

@Processor(METADATA_SYNC_QUEUE, {
  limiter: { max: 2, duration: 1000 }, // 2 jobs/sec → ~4 TMDB requests/sec, safe under 40req/10s
})
export class MetadataSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(MetadataSyncProcessor.name);

  constructor(
    private readonly syncService: SyncService,
    private readonly syncGateway: SyncGateway,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<MetadataSyncJobData>): Promise<void> {
    this.logger.log(`Processing metadata sync job for media #${job.data.mediaId}`);
    await this.syncService.syncSingleMedia(job.data.mediaId);

    // Emit updated media status and refreshed queue stats
    const media = await this.prisma.media.findUnique({
      where: { id: job.data.mediaId },
      select: { syncStatus: true },
    }).catch(() => null);

    if (media) {
      this.syncGateway.emitMediaUpdated(job.data.mediaId, media.syncStatus);
    }
    await this.syncGateway.emitStats();
  }
}
