import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useDebounce } from '@/hooks/use-debounce';
import { Trash2, RefreshCw, Search, RefreshCcw, ChevronUp, ChevronDown } from 'lucide-react';

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

type SortField = 'titleVf' | 'type' | 'releaseYear' | 'syncStatus' | 'nasAddedAt' | 'createdAt';

const selectClass = "px-3 py-2 rounded-md bg-zinc-900 border border-zinc-700 text-sm text-white focus:outline-none focus:border-zinc-500";

export default function MediaListPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Read state from URL params
  const typeFilter = searchParams.get('type') || '';
  const statusFilter = searchParams.get('status') || '';
  const videoQualityFilter = searchParams.get('videoQuality') || '';
  const audioFilter = searchParams.get('audio') || '';
  const sortBy = (searchParams.get('sortBy') as SortField) || 'nasAddedAt';
  const sortOrder = (searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc';
  const page = Number(searchParams.get('page')) || 1;

  // Search is local (debounced), also synced to URL
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

  // Build query params from audio filter
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

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortBy !== field) return null;
    return sortOrder === 'asc' ? <ChevronUp className="w-3 h-3 inline ml-1" /> : <ChevronDown className="w-3 h-3 inline ml-1" />;
  };

  const thClass = "text-left p-3 font-medium text-zinc-400 cursor-pointer hover:text-white select-none";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Médias</h1>
        <Button variant="outline" size="sm" onClick={() => enqueueMutation.mutate()} disabled={enqueueMutation.isPending}>
          <RefreshCcw className="w-4 h-4 mr-2" />
          {enqueueMutation.isPending ? 'En cours...' : 'Sync non-synchronisés'}
        </Button>
      </div>

      {enqueueMutation.isSuccess && (
        <p className="text-sm text-green-400 mb-4">{enqueueMutation.data?.queued} job(s) ajouté(s) à la queue</p>
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

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900">
            <tr>
              <th className={thClass} onClick={() => toggleSort('titleVf')}>Titre <SortIcon field="titleVf" /></th>
              <th className={`${thClass} hidden md:table-cell`} onClick={() => toggleSort('type')}>Type <SortIcon field="type" /></th>
              <th className={`${thClass} hidden lg:table-cell`} onClick={() => toggleSort('releaseYear')}>Année <SortIcon field="releaseYear" /></th>
              <th className={thClass} onClick={() => toggleSort('syncStatus')}>Statut <SortIcon field="syncStatus" /></th>
              <th className={`${thClass} hidden xl:table-cell`} onClick={() => toggleSort('nasAddedAt')}>Ajouté NAS <SortIcon field="nasAddedAt" /></th>
              <th className="text-right p-3 font-medium text-zinc-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="p-8 text-center text-zinc-500">Chargement...</td></tr>
            ) : data?.data?.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-zinc-500">Aucun résultat</td></tr>
            ) : (
              data?.data?.map((m: any) => (
                <tr key={m.id} className="border-t border-border hover:bg-zinc-900/50">
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
                    <Badge variant={STATUS_VARIANTS[m.syncStatus] ?? 'secondary'}>
                      {STATUS_LABELS[m.syncStatus] ?? m.syncStatus}
                    </Badge>
                  </td>
                  <td className="p-3 hidden xl:table-cell text-zinc-500 text-xs">
                    {m.nasAddedAt ? new Date(m.nasAddedAt).toLocaleDateString('fr-FR') : '-'}
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => syncMutation.mutate(m.id)} disabled={syncMutation.isPending} title="Re-synchroniser">
                        <RefreshCw className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => { if (confirm('Supprimer ce média ?')) deleteMutation.mutate(m.id); }} title="Supprimer">
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
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
          {/* Page selector */}
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
