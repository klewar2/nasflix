import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { NasModule } from '../nas/nas.module';
import { MetadataModule } from '../metadata/metadata.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [NasModule, MetadataModule, MediaModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
