import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JobEvent = { cineClubId: number; job: any };
export type JobProgressEvent = { cineClubId: number; jobId: number; percent: number };

let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) {
    const apiBase = import.meta.env.VITE_API_URL as string | undefined;
    const socketHost = apiBase ? apiBase.replace(/\/api$/, '') : '';
    socket = io(`${socketHost}/jobs`, { path: '/socket.io', transports: ['websocket', 'polling'] });
  }
  return socket;
}

export function useJobsSocket(handlers: {
  onCreated?: (e: JobEvent) => void;
  onStatus?: (e: JobEvent) => void;
  onProgress?: (e: JobProgressEvent) => void;
}) {
  useEffect(() => {
    const s = getSocket();
    const created = (e: JobEvent) => handlers.onCreated?.(e);
    const status = (e: JobEvent) => handlers.onStatus?.(e);
    const progress = (e: JobProgressEvent) => handlers.onProgress?.(e);
    s.on('job:created', created);
    s.on('job:status', status);
    s.on('job:progress', progress);
    return () => {
      s.off('job:created', created);
      s.off('job:status', status);
      s.off('job:progress', progress);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
