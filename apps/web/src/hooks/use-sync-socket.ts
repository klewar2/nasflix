import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

export interface SyncStats {
  active: number;
  waiting: number;
}

// Singleton socket — shared across all hook instances
let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) {
    const apiBase = import.meta.env.VITE_API_URL as string | undefined;
    // In prod VITE_API_URL = "https://api.railway.app/api" → strip "/api" to get socket host
    const socketHost = apiBase ? apiBase.replace(/\/api$/, '') : '';
    socket = io(`${socketHost}/sync`, { path: '/socket.io', transports: ['websocket', 'polling'] });
  }
  return socket;
}

export function useSyncSocket({
  onMediaUpdated,
}: {
  onMediaUpdated?: (data: { mediaId: number; syncStatus: string }) => void;
} = {}) {
  const [stats, setStats] = useState<SyncStats>({ active: 0, waiting: 0 });
  const [connected, setConnected] = useState(false);

  // Stable reference for the callback
  const stableOnMediaUpdated = useCallback(
    (data: { mediaId: number; syncStatus: string }) => onMediaUpdated?.(data),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    const s = getSocket();

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onStats = (data: SyncStats) => setStats(data);

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('sync:stats', onStats);
    s.on('sync:media-updated', stableOnMediaUpdated);

    if (s.connected) setConnected(true);

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('sync:stats', onStats);
      s.off('sync:media-updated', stableOnMediaUpdated);
    };
  }, [stableOnMediaUpdated]);

  return { stats, connected };
}
