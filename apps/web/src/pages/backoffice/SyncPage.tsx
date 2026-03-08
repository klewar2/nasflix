import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { RefreshCw } from 'lucide-react';

export default function SyncPage() {
  const queryClient = useQueryClient();

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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Synchronisation</h1>
        <Button onClick={() => fullSyncMutation.mutate()} disabled={fullSyncMutation.isPending}>
          <RefreshCw className={`w-4 h-4 mr-2 ${fullSyncMutation.isPending ? 'animate-spin' : ''}`} />
          {fullSyncMutation.isPending ? 'Sync en cours...' : 'Sync complète'}
        </Button>
      </div>

      {fullSyncMutation.isSuccess && (
        <Card className="mb-6 border-green-800"><CardContent className="p-4 text-sm text-green-400">Synchronisation terminée !</CardContent></Card>
      )}

      {unsync && unsync.total > 0 && (
        <Card className="mb-6 border-yellow-800"><CardContent className="p-4 text-sm text-yellow-400">{unsync.total} média(s) non synchronisé(s)</CardContent></Card>
      )}

      <Card>
        <CardHeader><CardTitle>Historique</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-zinc-500">Chargement...</p>
          ) : logs?.data?.length === 0 ? (
            <p className="text-zinc-500">Aucune synchronisation effectuée</p>
          ) : (
            <div className="space-y-3">
              {logs?.data?.map((log: any) => (
                <div key={log.id} className="flex items-center justify-between p-3 bg-zinc-900 rounded-md text-sm">
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
