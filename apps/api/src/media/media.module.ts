import { Module, forwardRef } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [forwardRef(() => JobsModule)],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
