import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useJobsSocket, type JobEvent } from '@/hooks/use-jobs-socket';
import { Loader2, RefreshCw, X } from 'lucide-react';

type JobKind = 'DOWNLOAD_TO_NAS' | 'DELETE_FROM_SEEDBOX' | 'DELETE_FROM_JELLYFIN';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Job = any;

const TAB_LABELS: Record<JobKind, string> = {
  DOWNLOAD_TO_NAS: 'Transferts',
  DELETE_FROM_SEEDBOX: 'Suppressions seedbox',
  DELETE_FROM_JELLYFIN: 'Suppressions Jellyfin',
};

const STATUS_VARIANT: Record<string, 'success' | 'destructive' | 'secondary' | 'default'> = {
  COMPLETED: 'success',
  FAILED: 'destructive',
  CANCELLED: 'secondary',
  PENDING: 'default',
  AWAITING_NAS: 'default',
  AWAITING_SEEDBOX: 'default',
  IN_PROGRESS: 'default',
};

export default function JobsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<JobKind>('DOWNLOAD_TO_NAS');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();

  const activeQuery = useQuery({
    queryKey: ['jobs-active'],
    queryFn: () => api.listActiveJobs(),
    refetchInterval: 15_000,
  });

  const historyQuery = useQuery({
    queryKey: ['jobs-history', tab, statusFilter, page],
    queryFn: () => api.listJobs({ kind: tab, status: statusFilter || undefined, page, limit: 50 }),
  });

  useJobsSocket({
    onCreated: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs-active'] });
      queryClient.invalidateQueries({ queryKey: ['jobs-history'] });
    },
    onStatus: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs-active'] });
      queryClient.invalidateQueries({ queryKey: ['jobs-history'] });
    },
    onProgress: (e) => {
      queryClient.setQueryData<{ items: Job[] }>(['jobs-active'], (old) => {
        if (!old) return old;
        return {
          items: old.items.map((j) => (j.id === e.jobId ? { ...j, progressPercent: e.percent } : j)),
        };
      });
    },
  });

  const activeForTab = useMemo(() => {
    const items = activeQuery.data?.items ?? [];
    return items.filter((j) => j.kind === tab);
  }, [activeQuery.data, tab]);

  if (!user?.isSuperAdmin) {
    return <p className="text-zinc-400 p-6">Page réservée aux super admins.</p>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Jobs</h1>

      <div className="flex gap-2 mb-6 border-b border-zinc-800">
        {(Object.keys(TAB_LABELS) as JobKind[]).map((k) => {
          const isActive = tab === k;
          const activeCount = (activeQuery.data?.items ?? []).filter((j) => j.kind === k).length;
          return (
            <button
              key={k}
              onClick={() => {
                setTab(k);
                setPage(1);
              }}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                isActive ? 'border-primary text-white' : 'border-transparent text-zinc-400 hover:text-white'
              }`}
            >
              {TAB_LABELS[k]}
              {activeCount > 0 && (
                <span className="text-[10px] bg-primary/20 text-primary px-1.5 rounded">{activeCount}</span>
              )}
            </button>
          );
        })}
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            En cours
            {activeQuery.isFetching && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activeForTab.length === 0 ? (
            <p className="text-sm text-zinc-500">Aucun job en cours.</p>
          ) : (
            <JobTable jobs={activeForTab} onAction={() => queryClient.invalidateQueries({ queryKey: ['jobs-active'] })} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Historique</CardTitle>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="bg-zinc-900 border border-zinc-800 text-zinc-200 rounded px-2 py-1 text-sm"
            >
              <option value="">Tous statuts</option>
              <option value="COMPLETED">COMPLETED</option>
              <option value="FAILED">FAILED</option>
              <option value="CANCELLED">CANCELLED</option>
              <option value="PENDING">PENDING</option>
              <option value="IN_PROGRESS">IN_PROGRESS</option>
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {historyQuery.isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
          ) : (historyQuery.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-zinc-500">Aucun job.</p>
          ) : (
            <>
              <JobTable
                jobs={historyQuery.data!.items}
                onAction={() => queryClient.invalidateQueries({ queryKey: ['jobs-history'] })}
              />
              <div className="flex items-center justify-between mt-4 text-sm text-zinc-500">
                <span>
                  Page {historyQuery.data!.page} — {historyQuery.data!.total} job(s)
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                    Précédent
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={(historyQuery.data!.items.length ?? 0) < historyQuery.data!.limit}
                  >
                    Suivant
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function JobTable({ jobs, onAction }: { jobs: Job[]; onAction: () => void }) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Job | null>(null);

  const doAction = async (id: number, action: 'cancel' | 'retry') => {
    setBusyId(id);
    try {
      if (action === 'cancel') await api.cancelJob(id);
      else await api.retryJob(id);
      onAction();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-zinc-500 border-b border-zinc-800">
              <th className="text-left py-2 pr-2">ID</th>
              <th className="text-left py-2 pr-2">Fichier</th>
              <th className="text-left py-2 pr-2">Source</th>
              <th className="text-left py-2 pr-2">Status</th>
              <th className="text-left py-2 pr-2">Progress</th>
              <th className="text-left py-2 pr-2">Créé</th>
              <th className="text-right py-2 pr-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="border-b border-zinc-900 hover:bg-zinc-900/30 cursor-pointer" onClick={() => setDetail(j)}>
                <td className="py-2 pr-2 text-zinc-500">#{j.id}</td>
                <td className="py-2 pr-2 truncate max-w-[300px]">{j.fileName ?? j.jellyfinItemId ?? '—'}</td>
                <td className="py-2 pr-2 text-zinc-400 text-xs">{j.source}</td>
                <td className="py-2 pr-2">
                  <Badge variant={STATUS_VARIANT[j.status] ?? 'default'}>{j.status}</Badge>
                </td>
                <td className="py-2 pr-2 text-zinc-400 text-xs">{j.progressPercent != null ? `${j.progressPercent}%` : '—'}</td>
                <td className="py-2 pr-2 text-zinc-500 text-xs">{new Date(j.createdAt).toLocaleString('fr-FR')}</td>
                <td className="py-2 pr-2 text-right" onClick={(e) => e.stopPropagation()}>
                  {(j.status === 'PENDING' || j.status === 'AWAITING_NAS' || j.status === 'AWAITING_SEEDBOX') && (
                    <Button size="sm" variant="outline" disabled={busyId === j.id} onClick={() => doAction(j.id, 'cancel')}>
                      <X className="w-3 h-3 mr-1" />Annuler
                    </Button>
                  )}
                  {(j.status === 'FAILED' || j.status === 'CANCELLED') && (
                    <Button size="sm" variant="outline" disabled={busyId === j.id} onClick={() => doAction(j.id, 'retry')}>
                      <RefreshCw className="w-3 h-3 mr-1" />Relancer
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail && <JobDetailModal job={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function JobDetailModal({ job, onClose }: { job: Job; onClose: () => void }) {
  // close on ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-zinc-950 border border-zinc-800 rounded-lg max-w-2xl w-full p-6 overflow-y-auto max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-lg font-bold">Job #{job.id}</h2>
            <p className="text-xs text-zinc-500">{job.kind} — {job.source}</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-2 text-sm">
          <Field label="Status">{job.status}</Field>
          <Field label="Fichier">{job.fileName ?? '—'}</Field>
          <Field label="Source path">{job.sourcePath ?? '—'}</Field>
          <Field label="Target path">{job.targetPath ?? '—'}</Field>
          {job.tmdbId && <Field label="TMDB">{job.tmdbType} / {job.tmdbId}</Field>}
          {job.jellyfinItemId && <Field label="Jellyfin">{job.jellyfinItemId}</Field>}
          {job.scheduledFor && <Field label="Planifié">{new Date(job.scheduledFor).toLocaleString('fr-FR')}</Field>}
          <Field label="Tentatives">{job.attempts}</Field>
          <Field label="Créé">{new Date(job.createdAt).toLocaleString('fr-FR')}</Field>
          {job.completedAt && <Field label="Terminé">{new Date(job.completedAt).toLocaleString('fr-FR')}</Field>}
        </div>
        {job.errorMessage && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-destructive mb-2">Erreur</h3>
            <pre className="text-xs bg-zinc-900 p-3 rounded border border-zinc-800 whitespace-pre-wrap break-words">{job.errorMessage}</pre>
            {job.errorDetails?.stack && (
              <details className="mt-2">
                <summary className="text-xs text-zinc-500 cursor-pointer">Stacktrace</summary>
                <pre className="text-[10px] bg-zinc-900 p-3 rounded mt-2 whitespace-pre-wrap break-words">{job.errorDetails.stack}</pre>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="text-zinc-500 min-w-[100px]">{label}</span>
      <span className="text-zinc-200 break-all">{children}</span>
    </div>
  );
}
