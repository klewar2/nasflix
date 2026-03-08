import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { NasModule } from '../nas/nas.module';

@Module({
  imports: [NasModule],
  controllers: [HealthController],
})
export class HealthModule {}
