import { WebSocketGateway, WebSocketServer, OnGatewayConnection } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { METADATA_SYNC_QUEUE } from './sync.constants';

export interface SyncStats {
  active: number;
  waiting: number;
}

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/sync' })
export class SyncGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(@InjectQueue(METADATA_SYNC_QUEUE) private metadataQueue: Queue) {}

  async handleConnection(client: Socket) {
    const stats = await this.getStats();
    client.emit('sync:stats', stats);
  }

  async emitStats() {
    if (!this.server) return;
    const stats = await this.getStats();
    this.server.emit('sync:stats', stats);
  }

  emitMediaUpdated(mediaId: number, syncStatus: string) {
    if (!this.server) return;
    this.server.emit('sync:media-updated', { mediaId, syncStatus });
  }

  emitNasOnline(cineClubId: number) {
    if (!this.server) return;
    this.server.emit('nas:online', { cineClubId });
  }

  private async getStats(): Promise<SyncStats> {
    const [active, waiting] = await Promise.all([
      this.metadataQueue.getActiveCount(),
      this.metadataQueue.getWaitingCount(),
    ]);
    return { active, waiting };
  }
}
