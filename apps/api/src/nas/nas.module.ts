import { Module } from '@nestjs/common';
import { NasController } from './nas.controller';
import { NasService } from './nas.service';
import { NasGateway } from './nas.gateway';

@Module({
  controllers: [NasController],
  providers: [NasService, NasGateway],
  exports: [NasService, NasGateway],
})
export class NasModule {}
