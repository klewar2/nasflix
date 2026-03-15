import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { RefreshCw, Square, Activity } from 'lucide-react';
import { useSyncSocket } from '@/hooks/use-sync-socket';

export default function SyncPage() {
  const queryClient = useQueryClient();
  const { stats } = useSyncSocket();
  const isQueueActive = stats.active > 0 || stats.waiting > 0;

  const { data: logs, isLoading } = useQuery({
    queryKey: ['sync', 'logs'],
    queryFn: () => api.getSyncLogs(1),
  });

  const { data: unsync } = useQuery({
    queryKey: ['unsync'],
    queryFn: () => api.getUnsynchronizedMedia(1),
  });

  const fullSyncMutation = useMutation({
    mutationFn: () => api.triggerFullSync(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync'] });
      queryClient.invalidateQueries({ queryKey: ['unsync'] });
    },
  });

  const drainMutation = useMutation({
    mutationFn: () => api.drainQueue(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync'] });
      queryClient.invalidateQueries({ queryKey: ['unsync'] });
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Synchronisation</h1>
        <div className="flex items-center gap-2">
          {isQueueActive && (
            <Button
              variant="outline"
              onClick={() => drainMutation.mutate()}
              disabled={drainMutation.isPending}
              className="border-red-800 text-red-400 hover:bg-red-950 hover:text-red-300"
            >
              <Square className="w-4 h-4 mr-2 fill-current" />
              {drainMutation.isPending ? 'Arrêt...' : 'Stopper la synchronisation'}
            </Button>
          )}
          <Button onClick={() => fullSyncMutation.mutate()} disabled={fullSyncMutation.isPending}>
            <RefreshCw className={`w-4 h-4 mr-2 ${fullSyncMutation.isPending ? 'animate-spin' : ''}`} />
            {fullSyncMutation.isPending ? 'Sync en cours...' : 'Sync complète'}
          </Button>
        </div>
      </div>

      {/* Live queue stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card className={`bg-white/[0.03] backdrop-blur-md ${isQueueActive ? 'border-primary/40' : 'border-white/[0.07]'}`}>
          <CardContent className="p-4 flex items-center gap-3">
            <Activity className={`w-5 h-5 ${isQueueActive ? 'text-primary animate-pulse' : 'text-zinc-600'}`} />
            <div>
              <p className="text-2xl font-bold">{stats.active}</p>
              <p className="text-xs text-zinc-500">Job(s) en cours</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white/[0.03] backdrop-blur-md border-white/[0.07]">
          <CardContent className="p-4 flex items-center gap-3">
            <RefreshCw className={`w-5 h-5 text-zinc-500 ${stats.waiting > 0 ? 'animate-spin' : ''}`} />
            <div>
              <p className="text-2xl font-bold">{stats.waiting}</p>
              <p className="text-xs text-zinc-500">En attente</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {fullSyncMutation.isSuccess && (
        <Card className="mb-6 bg-green-950/30 backdrop-blur-md border-green-800/50"><CardContent className="p-4 text-sm text-green-400">Synchronisation terminée !</CardContent></Card>
      )}

      {drainMutation.isSuccess && (
        <Card className="mb-6 bg-yellow-950/30 backdrop-blur-md border-yellow-800/50"><CardContent className="p-4 text-sm text-yellow-400">Synchronisation stoppée.</CardContent></Card>
      )}

      {unsync && unsync.total > 0 && (
        <Card className="mb-6 bg-yellow-950/20 backdrop-blur-md border-yellow-800/40"><CardContent className="p-4 text-sm text-yellow-400">{unsync.total} média(s) non synchronisé(s)</CardContent></Card>
      )}

      <Card className="bg-white/[0.03] backdrop-blur-md border-white/[0.07]">
        <CardHeader><CardTitle>Historique</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-zinc-500">Chargement...</p>
          ) : logs?.data?.length === 0 ? (
            <p className="text-zinc-500">Aucune synchronisation effectuée</p>
          ) : (
            <div className="space-y-3">
              {logs?.data?.map((log: any) => (
                <div key={log.id} className="flex items-center justify-between p-3 bg-white/[0.03] border border-white/[0.06] rounded-md text-sm">
                  <div>
                    <span className="text-zinc-400 mr-2">{new Date(log.startedAt).toLocaleString('fr-FR')}</span>
                    <Badge variant={log.status === 'completed' ? 'success' : log.status === 'running' ? 'warning' : 'destructive'}>{log.status}</Badge>
                  </div>
                  <div className="text-zinc-500">
                    {log.processedItems !== null && <span>{log.processedItems} traités</span>}
                    {log.errorCount > 0 && <span className="text-red-400 ml-2">{log.errorCount} erreurs</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
