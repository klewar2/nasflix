import { Module } from '@nestjs/common';
import { MetadataModule } from '../metadata/metadata.module';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';
import { RecommendationsScheduler } from './recommendations.scheduler';

@Module({
  imports: [MetadataModule],
  controllers: [RecommendationsController],
  providers: [RecommendationsService, RecommendationsScheduler],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
