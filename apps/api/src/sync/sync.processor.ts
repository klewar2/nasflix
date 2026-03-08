import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SyncService } from './sync.service';
import { METADATA_SYNC_QUEUE } from './sync.constants';

export interface MetadataSyncJobData {
  mediaId: number;
}

@Processor(METADATA_SYNC_QUEUE, {
  limiter: { max: 2, duration: 1000 }, // 2 jobs/sec → ~4 TMDB requests/sec, safe under 40req/10s
})
export class MetadataSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(MetadataSyncProcessor.name);

  constructor(private readonly syncService: SyncService) {
    super();
  }

  async process(job: Job<MetadataSyncJobData>): Promise<void> {
    this.logger.log(`Processing metadata sync job for media #${job.data.mediaId}`);
    await this.syncService.syncSingleMedia(job.data.mediaId);
  }
}
