import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './common/prisma.module';
import { AuthModule } from './auth/auth.module';
import { MediaModule } from './media/media.module';
import { NasModule } from './nas/nas.module';
import { MetadataModule } from './metadata/metadata.module';
import { SyncModule } from './sync/sync.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),
    PrismaModule,
    AuthModule,
    MediaModule,
    NasModule,
    MetadataModule,
    SyncModule,
    HealthModule,
  ],
})
export class AppModule {}
