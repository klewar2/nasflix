import { Controller, Post, Get, Param, Query, ParseIntPipe, Headers, Body, UnauthorizedException } from '@nestjs/common';
import { SyncService } from './sync.service';
import { ConfigService } from '@nestjs/config';
import { Public } from '../auth/guards/public.decorator';

@Controller('sync')
export class SyncController {
  constructor(
    private syncService: SyncService,
    private configService: ConfigService,
  ) {}

  @Post('full')
  async fullSync() {
    return this.syncService.fullSync('manual');
  }

  @Post('pending')
  async enqueuePending() {
    const queued = await this.syncService.enqueuePendingMetadata();
    return { message: `${queued} job(s) enqueued`, queued };
  }

  @Post('drain')
  async drainQueue() {
    return this.syncService.drainQueue();
  }

  @Post('media/:id')
  async syncSingleMedia(@Param('id', ParseIntPipe) id: number) {
    const result = await this.syncService.syncSingleMedia(id);
    return { message: 'Sync completed', ...result };
  }

  @Get('logs')
  async getLogs(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.syncService.getSyncLogs(page, limit);
  }

  @Public()
  @Post('webhook')
  async webhook(
    @Headers('x-sync-secret') secret: string,
    @Body() body: { added?: string[]; removed?: string[]; moved?: Array<{ from: string; to: string }> },
  ) {
    const expectedSecret = this.configService.get<string>('SYNC_WEBHOOK_SECRET');
    if (!expectedSecret || secret !== expectedSecret) {
      throw new UnauthorizedException('Invalid webhook secret');
    }

    const hasDiff = (body?.added?.length ?? 0) + (body?.removed?.length ?? 0) + (body?.moved?.length ?? 0) > 0;

    if (hasDiff) {
      this.syncService.diffSync(body).catch((err) => {
        console.error('Webhook diff sync failed:', err);
      });
    } else {
      this.syncService.fullSync('webhook').catch((err) => {
        console.error('Webhook sync failed:', err);
      });
    }

    return { message: 'Sync triggered' };
  }
}
