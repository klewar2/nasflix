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

@Module({
  imports: [
    NasModule,
    MediaModule,
    MailModule,
    BullModule.registerQueue({
      name: JOBS_QUEUE,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    }),
  ],
  controllers: [JobsController],
  providers: [JobsService, JobsProcessor, JobsGateway],
  exports: [JobsService, JobsGateway],
})
export class JobsModule {}
