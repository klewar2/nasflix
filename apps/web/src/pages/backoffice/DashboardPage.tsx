import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Film, Tv, AlertCircle, Wifi, WifiOff } from 'lucide-react';

export default function DashboardPage() {
  const { user, cineClub } = useAuth();

  const { data: nasStatus } = useQuery({
    queryKey: ['nas', 'status'],
    queryFn: () => api.getNasStatus(),
    refetchInterval: 30000,
  });
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
            {nasStatus?.online ? <Wifi className="w-4 h-4 text-green-500" /> : <WifiOff className="w-4 h-4 text-red-500" />}
          </CardHeader>
          <CardContent>
            <Badge variant={nasStatus?.online ? 'success' : 'destructive'}>{nasStatus?.online ? 'En ligne' : 'Hors ligne'}</Badge>
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
