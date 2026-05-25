import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/sync' })
export class NasGateway {
  @WebSocketServer()
  server: Server;

  emitNasOnline(cineClubId: number) {
    if (!this.server) return;
    this.server.emit('nas:online', { cineClubId });
  }

  emitNasWakeStarted(cineClubId: number, startedByUserId: number | null) {
    if (!this.server) return;
    this.server.emit('nas:wake-started', { cineClubId, startedByUserId });
  }

  emitNasWakeFailed(cineClubId: number, reason: string) {
    if (!this.server) return;
    this.server.emit('nas:wake-failed', { cineClubId, reason });
  }
}
