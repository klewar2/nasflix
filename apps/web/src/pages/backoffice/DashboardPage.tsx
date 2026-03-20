import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Film, Loader2, Power, Tv, AlertCircle, Wifi, WifiOff } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api', '') || '';

export default function DashboardPage() {
  const { user, cineClub } = useAuth();
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const wakeTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [waking, setWaking] = useState(false);
  const [wakeMessage, setWakeMessage] = useState<string | null>(null);

  const { data: nasStatus } = useQuery({
    queryKey: ['nas', 'status'],
    queryFn: () => api.getNasStatus(),
    refetchInterval: waking ? 10000 : 30000,
  });

  const wakeMutation = useMutation({
    mutationFn: () => api.wakeNas(),
    onSuccess: () => {
      setWaking(true);
      setWakeMessage('Magic packet envoyé. En attente du démarrage du NAS...');
      // Timeout de sécurité : si le NAS ne répond pas en 5 min, annuler
      clearTimeout(wakeTimeoutRef.current);
      wakeTimeoutRef.current = setTimeout(() => {
        setWaking(false);
        setWakeMessage('Pas de réponse du NAS après 5 minutes. Vérifiez qu\'il est branché et que le WoL est activé.');
      }, 5 * 60 * 1000);
    },
    onError: (err: Error) => {
      setWakeMessage(err.message);
    },
  });

  // WebSocket : écouter nas:online pour confirmer le réveil
  useEffect(() => {
    const socket = io(`${API_BASE}/sync`, { transports: ['websocket'] });
    socketRef.current = socket;
    socket.on('nas:online', ({ cineClubId }: { cineClubId: number }) => {
      if (cineClubId !== cineClub?.id) return;
      clearTimeout(wakeTimeoutRef.current);
      setWaking(false);
      setWakeMessage('NAS démarré avec succès !');
      queryClient.invalidateQueries({ queryKey: ['nas', 'status'] });
      setTimeout(() => setWakeMessage(null), 5000);
    });
    return () => { socket.disconnect(); };
  }, [cineClub?.id, queryClient]);

  useEffect(() => () => clearTimeout(wakeTimeoutRef.current), []);

  const isAdmin = cineClub?.role === 'ADMIN';
  const nasOnline = nasStatus?.online;
  const showWakeButton = isAdmin && !nasOnline && cineClub?.nasWolMac;

  const { data: movies } = useQuery({ queryKey: ['stats', 'movies'], queryFn: () => api.getMedia({ type: 'MOVIE', limit: 1 }) });
  const { data: series } = useQuery({ queryKey: ['stats', 'series'], queryFn: () => api.getMedia({ type: 'SERIES', limit: 1 }) });
  const { data: unsync } = useQuery({ queryKey: ['stats', 'unsync'], queryFn: () => api.getUnsynchronizedMedia(1) });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        {cineClub && <p className="text-zinc-400 text-sm mt-1">{cineClub.name}</p>}
        {user && <p className="text-zinc-500 text-xs mt-0.5">Connecté en tant que {user.firstName} {user.lastName}</p>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white/[0.03] backdrop-blur-md border-white/[0.07]">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">NAS</CardTitle>
            {nasOnline ? <Wifi className="w-4 h-4 text-green-500" /> : <WifiOff className="w-4 h-4 text-red-500" />}
          </CardHeader>
          <CardContent className="space-y-3">
            <Badge variant={nasOnline ? 'success' : 'destructive'}>{nasOnline ? 'En ligne' : 'Hors ligne'}</Badge>
            {showWakeButton && (
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-2"
                disabled={waking || wakeMutation.isPending}
                onClick={() => wakeMutation.mutate()}
              >
                {waking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
                {waking ? 'Démarrage...' : 'Allumer le NAS'}
              </Button>
            )}
            {wakeMessage && (
              <p className={`text-xs leading-snug ${wakeMessage.includes('succès') ? 'text-green-400' : 'text-zinc-400'}`}>
                {wakeMessage}
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="bg-white/[0.03] backdrop-blur-md border-white/[0.07]">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">Films</CardTitle>
            <Film className="w-4 h-4 text-zinc-500" />
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{(movies as { total?: number } | undefined)?.total ?? 0}</p></CardContent>
        </Card>
        <Card className="bg-white/[0.03] backdrop-blur-md border-white/[0.07]">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">Séries</CardTitle>
            <Tv className="w-4 h-4 text-zinc-500" />
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{(series as { total?: number } | undefined)?.total ?? 0}</p></CardContent>
        </Card>
        <Card className="bg-white/[0.03] backdrop-blur-md border-white/[0.07]">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">Non synchronisés</CardTitle>
            <AlertCircle className="w-4 h-4 text-yellow-500" />
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{(unsync as { total?: number } | undefined)?.total ?? 0}</p></CardContent>
        </Card>
      </div>
    </div>
  );
}
