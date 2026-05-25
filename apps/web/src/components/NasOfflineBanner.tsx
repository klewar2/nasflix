import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { Loader2, Power, WifiOff } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api', '') || '';

function formatElapsed(startedAt: string | null): string {
  if (!startedAt) return '';
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  if (elapsed < 60) return `${elapsed}s`;
  return `${Math.floor(elapsed / 60)}min ${elapsed % 60}s`;
}

function formatRemaining(startedAt: string | null, timeoutSeconds: number): string {
  if (!startedAt) return '';
  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  const remaining = Math.max(0, timeoutSeconds - elapsed);
  if (remaining === 0) return '0s';
  if (remaining < 60) return `${remaining}s`;
  return `~${Math.ceil(remaining / 60)} min`;
}

export function NasOfflineBanner() {
  const { cineClub } = useAuth();
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const [tickMs, setTickMs] = useState(0);

  const { data: status } = useQuery({
    queryKey: ['nas', 'status'],
    queryFn: () => api.getNasStatus(),
    refetchInterval: 5000,
  });

  const wakeMutation = useMutation({
    mutationFn: () => api.wakeNas(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nas', 'status'] });
    },
  });

  // Tick local pour mettre à jour le compteur "il y a X secondes" sans hammer le réseau
  useEffect(() => {
    if (!status?.wakeInProgress) return;
    const interval = setInterval(() => setTickMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [status?.wakeInProgress]);

  // WebSocket : invalidate la query plus tôt que le polling 5s
  useEffect(() => {
    if (!cineClub?.id) return;
    const socket = io(`${API_BASE}/sync`, { transports: ['websocket'] });
    socketRef.current = socket;
    const invalidate = (payload: { cineClubId: number }) => {
      if (payload.cineClubId === cineClub.id) {
        queryClient.invalidateQueries({ queryKey: ['nas', 'status'] });
      }
    };
    socket.on('nas:online', invalidate);
    socket.on('nas:wake-started', invalidate);
    socket.on('nas:wake-failed', invalidate);
    return () => {
      socket.disconnect();
    };
  }, [cineClub?.id, queryClient]);

  // void tickMs pour que React relance le render à chaque seconde quand wake en cours
  void tickMs;

  if (!status) return null;
  if (status.online) return null;
  if (!cineClub?.nasWolMac) return null; // pas de bouton si pas de WoL configuré

  const inProgress = status.wakeInProgress;

  return (
    <div className="bg-gradient-to-r from-red-950/80 via-red-900/60 to-red-950/80 border-b border-red-500/30 px-3 md:px-12 py-3 backdrop-blur-md">
      <div className="flex items-center justify-between gap-4 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <WifiOff className="w-5 h-5 text-red-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-white">NAS hors ligne</p>
            {inProgress ? (
              <p className="text-xs text-zinc-300">
                Démarrage en cours… (il y a {formatElapsed(status.wakeStartedAt)}, encore {formatRemaining(status.wakeStartedAt, status.wakeTimeoutSeconds)})
              </p>
            ) : (
              <p className="text-xs text-zinc-300">Démarre-le pour accéder au streaming.</p>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 bg-white/5 border-white/20 hover:bg-white/10"
          disabled={inProgress || wakeMutation.isPending}
          onClick={() => wakeMutation.mutate()}
        >
          {inProgress || wakeMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Power className="w-4 h-4" />
          )}
          {inProgress ? 'Démarrage…' : 'Démarrer le NAS'}
        </Button>
      </div>
    </div>
  );
}
