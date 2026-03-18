import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { MetadataSyncProcessor } from './sync.processor';
import { SyncGateway } from './sync.gateway';
import { NasModule } from '../nas/nas.module';
import { MetadataModule } from '../metadata/metadata.module';
import { MediaModule } from '../media/media.module';
import { PrismaModule } from '../common/prisma.module';
import { METADATA_SYNC_QUEUE } from './sync.constants';

@Module({
  imports: [
    NasModule,
    MetadataModule,
    MediaModule,
    PrismaModule,
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
  providers: [SyncService, MetadataSyncProcessor, SyncGateway],
  exports: [SyncService],
})
export class SyncModule {}
