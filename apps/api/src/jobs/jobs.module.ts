import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JobsProcessor } from './jobs.processor';
import { JobsGateway } from './jobs.gateway';
import { JOBS_QUEUE } from './jobs.constants';
import { NasModule } from '../nas/nas.module';
import { MediaModule } from '../media/media.module';
import { MailModule } from '../mail/mail.module';
import { MetadataModule } from '../metadata/metadata.module';
import { METADATA_SYNC_QUEUE } from '../sync/sync.constants';

@Module({
  imports: [
    NasModule,
    MediaModule,
    MailModule,
    MetadataModule,
    BullModule.registerQueue({
      name: JOBS_QUEUE,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    }),
    // Réference seule (consumer dans SyncModule). Permet à JobsProcessor d'y pousser
    // un media après transfert pour déclencher la sync TMDB → syncStatus=SYNCED.
    BullModule.registerQueue({ name: METADATA_SYNC_QUEUE }),
  ],
  controllers: [JobsController],
  providers: [JobsService, JobsProcessor, JobsGateway],
  exports: [JobsService, JobsGateway],
})
export class JobsModule {}
