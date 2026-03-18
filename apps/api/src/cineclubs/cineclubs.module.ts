import { Module } from '@nestjs/common';
import { CineClubsController } from './cineclubs.controller';
import { CineClubsService } from './cineclubs.service';

@Module({
  controllers: [CineClubsController],
  providers: [CineClubsService],
  exports: [CineClubsService],
})
export class CineClubsModule {}
