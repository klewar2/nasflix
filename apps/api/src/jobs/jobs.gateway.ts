import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import type { Job as JobRow } from '@prisma/client';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/jobs' })
export class JobsGateway {
  @WebSocketServer()
  server: Server;

  emitJobCreated(cineClubId: number, job: JobRow) {
    if (!this.server) return;
    this.server.emit('job:created', this.toRoom(cineClubId, job));
  }

  emitJobStatus(cineClubId: number, job: JobRow) {
    if (!this.server) return;
    this.server.emit('job:status', this.toRoom(cineClubId, job));
  }

  emitJobProgress(cineClubId: number, jobId: number, percent: number) {
    if (!this.server) return;
    this.server.emit('job:progress', { cineClubId, jobId, percent });
  }

  private toRoom(cineClubId: number, job: JobRow) {
    return {
      cineClubId,
      job: {
        ...job,
        fileSize: job.fileSize?.toString() ?? null,
      },
    };
  }
}
