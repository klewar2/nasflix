import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '@/lib/auth';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useDebounce } from '@/hooks/use-debounce';
import { useSyncSocket } from '@/hooks/use-sync-socket';
import { Trash2, RefreshCw, Search, RefreshCcw, ChevronUp, ChevronDown, Square, Wifi, WifiOff } from 'lucide-react';

const STATUS_LABELS: Record<string, string> = {
  SYNCED: 'Synchronisé', PENDING: 'En attente', SYNCING: 'En cours',
  FAILED: 'Erreur', NOT_FOUND: 'Introuvable',
};

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'secondary' | 'destructive'> = {
  SYNCED: 'success', PENDING: 'warning', SYNCING: 'secondary',
  FAILED: 'destructive', NOT_FOUND: 'destructive',
};

function QualityBadges({ media }: { media: any }) {
  return (
    <div className="flex items-center gap-1 flex-wrap mt-1">
      {media.videoQuality === '4K' && (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">4K</span>
      )}
      {media.videoQuality === '1080p' && (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">FHD</span>
      )}
      {media.dolbyVision && (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-600/30 text-blue-300 border border-blue-500/30">DV</span>
      )}
      {media.hdr && !media.dolbyVision && (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30">HDR</span>
      )}
      {media.dolbyAtmos && (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">ATMOS</span>
      )}
      {media.audioFormat && !media.dolbyAtmos && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/50 text-zinc-400 border border-zinc-600/30">{media.audioFormat}</span>
      )}
    </div>
  );
}

type SortField = 'titleVf' | 'type' | 'releaseYear' | 'syncStatus' | 'nasAddedAt' | 'createdAt' | 'lastSyncedAt';

const selectClass = "px-3 py-2 rounded-md bg-white/[0.04] backdrop-blur-sm border border-white/[0.08] text-sm text-white focus:outline-none focus:border-white/20";

function SortIcon({ field, sortBy, sortOrder }: { field: SortField; sortBy: SortField; sortOrder: 'asc' | 'desc' }) {
  if (sortBy !== field) return null;
  return sortOrder === 'asc' ? <ChevronUp className="w-3 h-3 inline ml-1" /> : <ChevronDown className="w-3 h-3 inline ml-1" />;
}

function formatDateTime(dateStr: string | null | undefined) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function MediaListPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { cineClub } = useAuth();
  const isAdmin = cineClub?.role === 'ADMIN';

  const typeFilter = searchParams.get('type') || '';
  const statusFilter = searchParams.get('status') || '';
  const videoQualityFilter = searchParams.get('videoQuality') || '';
  const audioFilter = searchParams.get('audio') || '';
  const sortBy = (searchParams.get('sortBy') as SortField) || 'nasAddedAt';
  const sortOrder = (searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc';
  const page = Number(searchParams.get('page')) || 1;

  const [search, setSearch] = useState(searchParams.get('q') || '');
  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (debouncedSearch) next.set('q', debouncedSearch);
      else next.delete('q');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [debouncedSearch]); // eslint-disable-line

  const setParam = (key: string, value: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete('page');
      return next;
    });
  };

  const setPage = (p: number) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (p > 1) next.set('page', String(p));
      else next.delete('page');
      return next;
    });
  };

  const dolbyAtmos = audioFilter === 'dolbyAtmos' ? 'true' : undefined;
  const dolbyVision = audioFilter === 'dolbyVision' ? 'true' : undefined;
  const hdr = audioFilter === 'hdr' ? 'true' : undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'media', debouncedSearch, typeFilter, statusFilter, videoQualityFilter, audioFilter, sortBy, sortOrder, page],
    queryFn: () => api.getAdminMedia({
      title: debouncedSearch || undefined,
      type: typeFilter || undefined,
      status: statusFilter || undefined,
      videoQuality: videoQualityFilter || undefined,
      dolbyAtmos,
      dolbyVision,
      hdr,
      sortBy,
      sortOrder,
      page,
      limit: 20,
    }),
  });

  // Refresh table automatically when any media finishes syncing
  const handleMediaUpdated = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'media'] });
  }, [queryClient]);

  const { stats, connected } = useSyncSocket({ onMediaUpdated: handleMediaUpdated });
  const isQueueActive = stats.active > 0 || stats.waiting > 0;

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteMedia(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'media'] }),
  });

  const syncMutation = useMutation({
    mutationFn: (id: number) => api.syncSingleMedia(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'media'] }),
  });

  const enqueueMutation = useMutation({
    mutationFn: () => api.enqueuePendingSync(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'media'] }),
  });

  const drainMutation = useMutation({
    mutationFn: () => api.drainQueue(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'media'] }),
  });

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setParam('sortOrder', sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.set('sortBy', field);
        next.set('sortOrder', 'desc');
        next.delete('page');
        return next;
      });
    }
  };

  const thClass = "text-left p-3 font-medium text-zinc-400 cursor-pointer hover:text-white select-none";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Médias</h1>
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            {connected
              ? <Wifi className="w-3 h-3 text-green-500" />
              : <WifiOff className="w-3 h-3 text-zinc-600" />
            }
            {isQueueActive && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                {stats.active > 0 && <span>{stats.active} en cours</span>}
                {stats.waiting > 0 && <span className="text-zinc-500">· {stats.waiting} en attente</span>}
              </span>
            )}
          </div>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2">
            {isQueueActive && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => drainMutation.mutate()}
                disabled={drainMutation.isPending}
                className="border-red-800 text-red-400 hover:bg-red-950 hover:text-red-300"
              >
                <Square className="w-3.5 h-3.5 mr-1.5 fill-current" />
                {drainMutation.isPending ? 'Arrêt...' : 'Stopper la synchronisation'}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => enqueueMutation.mutate()} disabled={enqueueMutation.isPending}>
              <RefreshCcw className="w-4 h-4 mr-2" />
              {enqueueMutation.isPending ? 'En cours...' : 'Sync non-synchronisés'}
            </Button>
          </div>
        )}
      </div>

      {enqueueMutation.isSuccess && (
        <p className="text-sm text-green-400 mb-4">{enqueueMutation.data?.queued} job(s) ajouté(s) à la queue</p>
      )}
      {drainMutation.isSuccess && (
        <p className="text-sm text-yellow-400 mb-4">Queue vidée — les médias en PENDING peuvent être re-synchronisés.</p>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <Input
            placeholder="Rechercher..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select value={typeFilter} onChange={(e) => setParam('type', e.target.value)} className={selectClass}>
          <option value="">Tous les types</option>
          <option value="MOVIE">Films</option>
          <option value="SERIES">Séries</option>
        </select>
        <select value={statusFilter} onChange={(e) => setParam('status', e.target.value)} className={selectClass}>
          <option value="">Tous les statuts</option>
          <option value="SYNCED">Synchronisé</option>
          <option value="PENDING">En attente</option>
          <option value="SYNCING">En cours</option>
          <option value="FAILED">Erreur</option>
          <option value="NOT_FOUND">Introuvable</option>
        </select>
        <select value={videoQualityFilter} onChange={(e) => setParam('videoQuality', e.target.value)} className={selectClass}>
          <option value="">Toutes qualités vidéo</option>
          <option value="4K">4K UHD</option>
          <option value="1080p">Full HD</option>
          <option value="720p">HD 720p</option>
        </select>
        <select value={audioFilter} onChange={(e) => setParam('audio', e.target.value)} className={selectClass}>
          <option value="">Tous formats audio</option>
          <option value="dolbyAtmos">Dolby Atmos</option>
          <option value="dolbyVision">Dolby Vision</option>
          <option value="hdr">HDR</option>
        </select>
      </div>

      <div className={`rounded-xl border border-white/[0.07] bg-white/[0.02] backdrop-blur-sm overflow-hidden transition-opacity duration-200 ${enqueueMutation.isPending || drainMutation.isPending ? 'opacity-40 pointer-events-none' : ''}`}>
        <table className="w-full text-sm">
          <thead className="bg-white/[0.04]">
            <tr>
              <th className={thClass} onClick={() => toggleSort('titleVf')}>Titre <SortIcon field="titleVf" sortBy={sortBy} sortOrder={sortOrder} /></th>
              <th className={`${thClass} hidden md:table-cell`} onClick={() => toggleSort('type')}>Type <SortIcon field="type" sortBy={sortBy} sortOrder={sortOrder} /></th>
              <th className={`${thClass} hidden lg:table-cell`} onClick={() => toggleSort('releaseYear')}>Année <SortIcon field="releaseYear" sortBy={sortBy} sortOrder={sortOrder} /></th>
              <th className={thClass} onClick={() => toggleSort('syncStatus')}>Statut <SortIcon field="syncStatus" sortBy={sortBy} sortOrder={sortOrder} /></th>
              <th className={`${thClass} hidden xl:table-cell`} onClick={() => toggleSort('nasAddedAt')}>Ajouté le <SortIcon field="nasAddedAt" sortBy={sortBy} sortOrder={sortOrder} /></th>
              <th className={`${thClass} hidden 2xl:table-cell`} onClick={() => toggleSort('lastSyncedAt')}>Dernière sync <SortIcon field="lastSyncedAt" sortBy={sortBy} sortOrder={sortOrder} /></th>
              <th className="text-right p-3 font-medium text-zinc-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="p-8 text-center text-zinc-500">Chargement...</td></tr>
            ) : data?.data?.length === 0 ? (
              <tr><td colSpan={7} className="p-8 text-center text-zinc-500">Aucun résultat</td></tr>
            ) : (
              data?.data?.map((m: any) => (
                <tr key={m.id} className="border-t border-white/[0.05] hover:bg-white/[0.03]">
                  <td className="p-3">
                    <Link to={`/admin/media/${m.id}`} className="hover:text-primary">
                      <p className="font-medium truncate max-w-xs">{m.titleVf || m.titleOriginal}</p>
                      <p className="text-xs text-zinc-500 truncate max-w-xs">{m.nasFilename}</p>
                      <QualityBadges media={m} />
                    </Link>
                  </td>
                  <td className="p-3 hidden md:table-cell">
                    <Badge variant="secondary">{m.type === 'MOVIE' ? 'Film' : 'Série'}</Badge>
                  </td>
                  <td className="p-3 hidden lg:table-cell text-zinc-400">{m.releaseYear || '-'}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-1.5">
                      <Badge variant={STATUS_VARIANTS[m.syncStatus] ?? 'secondary'}>
                        {STATUS_LABELS[m.syncStatus] ?? m.syncStatus}
                      </Badge>
                      {m.syncStatus === 'SYNCING' && (
                        <RefreshCw className="w-3 h-3 text-zinc-400 animate-spin" />
                      )}
                    </div>
                  </td>
                  <td className="p-3 hidden xl:table-cell text-zinc-500 text-xs">
                    {(m.nasAddedAt || m.createdAt) ? new Date(m.nasAddedAt || m.createdAt).toLocaleDateString('fr-FR') : '-'}
                  </td>
                  <td className="p-3 hidden 2xl:table-cell text-zinc-500 text-xs">
                    {formatDateTime(m.lastSyncedAt)}
                  </td>
                  <td className="p-3 text-right">
                    {isAdmin && (
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => syncMutation.mutate(m.id)} disabled={syncMutation.isPending} title="Re-synchroniser">
                          <RefreshCw className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => { if (confirm('Supprimer ce média ?')) deleteMutation.mutate(m.id); }} title="Supprimer">
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setPage(1)} disabled={page === 1}>«</Button>
          <Button variant="outline" size="sm" onClick={() => setPage(page - 1)} disabled={page === 1}>Précédent</Button>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(data.totalPages, 7) }, (_, i) => {
              let p: number;
              if (data.totalPages <= 7) {
                p = i + 1;
              } else if (page <= 4) {
                p = i + 1;
              } else if (page >= data.totalPages - 3) {
                p = data.totalPages - 6 + i;
              } else {
                p = page - 3 + i;
              }
              return (
                <Button
                  key={p}
                  variant={p === page ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPage(p)}
                  className="w-9 px-0"
                >
                  {p}
                </Button>
              );
            })}
          </div>
          <Button variant="outline" size="sm" onClick={() => setPage(page + 1)} disabled={page >= data.totalPages}>Suivant</Button>
          <Button variant="outline" size="sm" onClick={() => setPage(data.totalPages)} disabled={page >= data.totalPages}>»</Button>
          <span className="text-sm text-zinc-500">({data.total} résultats)</span>
        </div>
      )}
    </div>
  );
}
