import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Film, Tv, AlertCircle, Wifi, WifiOff } from 'lucide-react';

export default function DashboardPage() {
  const { data: health } = useQuery({ queryKey: ['health'], queryFn: () => api.getHealth(), refetchInterval: 30000 });
  const { data: movies } = useQuery({ queryKey: ['stats', 'movies'], queryFn: () => api.getMedia({ type: 'MOVIE', limit: 1 }) });
  const { data: series } = useQuery({ queryKey: ['stats', 'series'], queryFn: () => api.getMedia({ type: 'SERIES', limit: 1 }) });
  const { data: unsync } = useQuery({ queryKey: ['stats', 'unsync'], queryFn: () => api.getUnsynchronizedMedia(1) });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">NAS</CardTitle>
            {health?.nas === 'online' ? <Wifi className="w-4 h-4 text-green-500" /> : <WifiOff className="w-4 h-4 text-red-500" />}
          </CardHeader>
          <CardContent>
            <Badge variant={health?.nas === 'online' ? 'success' : 'destructive'}>{health?.nas === 'online' ? 'En ligne' : 'Hors ligne'}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">Films</CardTitle>
            <Film className="w-4 h-4 text-zinc-500" />
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{movies?.total || 0}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">Séries</CardTitle>
            <Tv className="w-4 h-4 text-zinc-500" />
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{series?.total || 0}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">Non synchronisés</CardTitle>
            <AlertCircle className="w-4 h-4 text-yellow-500" />
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{unsync?.total || 0}</p></CardContent>
        </Card>
      </div>
    </div>
  );
}
