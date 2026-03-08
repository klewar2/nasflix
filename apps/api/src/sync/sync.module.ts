import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { MetadataSyncProcessor } from './sync.processor';
import { NasModule } from '../nas/nas.module';
import { MetadataModule } from '../metadata/metadata.module';
import { MediaModule } from '../media/media.module';
import { METADATA_SYNC_QUEUE } from './sync.constants';

@Module({
  imports: [
    NasModule,
    MetadataModule,
    MediaModule,
    BullModule.registerQueue({
      name: METADATA_SYNC_QUEUE,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 500,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    }),
  ],
  controllers: [SyncController],
  providers: [SyncService, MetadataSyncProcessor],
  exports: [SyncService],
})
export class SyncModule {}
