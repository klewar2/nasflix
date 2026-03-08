import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useDebounce } from '@/hooks/use-debounce';
import { Trash2, RefreshCw, Search } from 'lucide-react';

export default function MediaListPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'media', debouncedSearch, page],
    queryFn: () => debouncedSearch ? api.searchMedia(debouncedSearch, page) : api.getMedia({ page, limit: 20 }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteMedia(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'media'] }),
  });

  const syncMutation = useMutation({
    mutationFn: (id: number) => api.syncSingleMedia(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'media'] }),
  });

  const syncStatusColor = (status: string) => {
    switch (status) {
      case 'SYNCED': return 'success' as const;
      case 'PENDING': return 'warning' as const;
      case 'FAILED': case 'NOT_FOUND': return 'destructive' as const;
      default: return 'secondary' as const;
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Médias</h1>
      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <Input placeholder="Rechercher..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-9" />
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900">
            <tr>
              <th className="text-left p-3 font-medium text-zinc-400">Titre</th>
              <th className="text-left p-3 font-medium text-zinc-400 hidden md:table-cell">Type</th>
              <th className="text-left p-3 font-medium text-zinc-400 hidden lg:table-cell">Année</th>
              <th className="text-left p-3 font-medium text-zinc-400">Statut</th>
              <th className="text-right p-3 font-medium text-zinc-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="p-8 text-center text-zinc-500">Chargement...</td></tr>
            ) : data?.data?.length === 0 ? (
              <tr><td colSpan={5} className="p-8 text-center text-zinc-500">Aucun résultat</td></tr>
            ) : (
              data?.data?.map((m: any) => (
                <tr key={m.id} className="border-t border-border hover:bg-zinc-900/50">
                  <td className="p-3">
                    <Link to={`/admin/media/${m.id}`} className="hover:text-primary">
                      <p className="font-medium truncate max-w-xs">{m.titleVf || m.titleOriginal}</p>
                      <p className="text-xs text-zinc-500 truncate max-w-xs">{m.nasFilename}</p>
                    </Link>
                  </td>
                  <td className="p-3 hidden md:table-cell"><Badge variant="secondary">{m.type === 'MOVIE' ? 'Film' : 'Série'}</Badge></td>
                  <td className="p-3 hidden lg:table-cell text-zinc-400">{m.releaseYear || '-'}</td>
                  <td className="p-3"><Badge variant={syncStatusColor(m.syncStatus)}>{m.syncStatus}</Badge></td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => syncMutation.mutate(m.id)} disabled={syncMutation.isPending} title="Synchroniser">
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

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Précédent</Button>
          <span className="text-sm text-zinc-400">Page {page} / {data.totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= data.totalPages}>Suivant</Button>
        </div>
      )}
    </div>
  );
}
