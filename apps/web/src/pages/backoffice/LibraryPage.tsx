import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, RefreshCw, Upload } from 'lucide-react';

type Tab = 'radarr' | 'sonarr';

 
type RadarrItem = any;
 
type SonarrItem = any;

export default function LibraryPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('radarr');

  if (!user?.isSuperAdmin) {
    return <p className="text-zinc-400 p-6">Page réservée aux super admins.</p>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Bibliothèque Radarr / Sonarr</h1>
      <p className="text-sm text-zinc-500 mb-6">Reprise sur historique — transfère vers le NAS les films/épisodes déjà téléchargés mais pas encore sur le NAS.</p>

      <div className="flex gap-2 mb-6 border-b border-zinc-800">
        {(['radarr', 'sonarr'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              tab === t ? 'border-primary text-white' : 'border-transparent text-zinc-400 hover:text-white'
            }`}
          >
            {t === 'radarr' ? 'Films (Radarr)' : 'Séries (Sonarr)'}
          </button>
        ))}
      </div>

      {tab === 'radarr' ? <RadarrTab /> : <SonarrTab />}
    </div>
  );
}

function RadarrTab() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'not_on_nas' | 'all'>('not_on_nas');
  const [search, setSearch] = useState('');

  const query = useQuery({
    queryKey: ['library-radarr'],
    queryFn: () => api.getRadarrLibrary(),
    staleTime: 60_000,
  });

  const transfer = useMutation({
    mutationFn: (item: RadarrItem) =>
      api.triggerManualTransfer({
        sourcePath: item.sourcePath,
        fileName: item.fileName ?? undefined,
        fileSize: item.fileSize ?? undefined,
        tmdbId: item.tmdbId ?? undefined,
        tmdbType: 'movie',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library-radarr'] });
      queryClient.invalidateQueries({ queryKey: ['jobs-active'] });
    },
  });

  const totalWithFile = (query.data?.items ?? []).filter((i) => i.hasFile && i.sourcePath).length;
  const filtered: RadarrItem[] = useMemo(() => {
    const items = (query.data?.items ?? []).filter((i) => i.hasFile && i.sourcePath);
    return items
      .filter((i) => (filter === 'all' ? true : !i.onNas))
      .filter((i) => (search ? i.title.toLowerCase().includes(search.toLowerCase()) : true))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [query.data, filter, search]);
  const emptyMessage = totalWithFile === 0
    ? 'Aucun film importé sur Radarr.'
    : filter === 'not_on_nas'
      ? `Tous les films Radarr (${totalWithFile}) sont déjà sur le NAS.`
      : 'Aucun film correspondant.';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="flex items-center gap-2">
            {query.data ? `${filtered.length} film(s)` : 'Chargement...'}
            {query.isFetching && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />}
          </CardTitle>
          <div className="flex gap-2 items-center">
            <Input
              placeholder="Rechercher..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-48"
            />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as 'not_on_nas' | 'all')}
              className="bg-zinc-900 border border-zinc-800 text-zinc-200 rounded px-2 py-1 text-sm"
            >
              <option value="not_on_nas">Non sur NAS</option>
              <option value="all">Tous</option>
            </select>
            <Button size="sm" variant="outline" onClick={() => query.refetch()}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Rafraîchir
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {query.isError && (
          <p className="text-sm text-destructive">
            {query.error instanceof Error ? query.error.message : 'Erreur Radarr'}
          </p>
        )}
        {query.isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-zinc-500 border-b border-zinc-800">
                  <th className="text-left py-2 pr-2">Titre</th>
                  <th className="text-left py-2 pr-2">Année</th>
                  <th className="text-left py-2 pr-2">TMDB</th>
                  <th className="text-left py-2 pr-2">Qualité</th>
                  <th className="text-left py-2 pr-2">Statut</th>
                  <th className="text-right py-2 pr-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.radarrId} className="border-b border-zinc-900 hover:bg-zinc-900/30">
                    <td className="py-2 pr-2 truncate max-w-[400px]">
                      <div>{item.title}</div>
                      <div className="text-[10px] text-zinc-600 truncate">{item.sourcePath}</div>
                    </td>
                    <td className="py-2 pr-2 text-zinc-400">{item.year}</td>
                    <td className="py-2 pr-2 text-zinc-500 text-xs">{item.tmdbId ?? '—'}</td>
                    <td className="py-2 pr-2 text-zinc-400 text-xs">{item.quality ?? '—'}</td>
                    <td className="py-2 pr-2">
                      {item.onNas ? (
                        <Badge variant="success">Sur NAS</Badge>
                      ) : item.activeJobId ? (
                        <Badge variant="default">Job #{item.activeJobId}</Badge>
                      ) : item.nasDeletedAt ? (
                        <Badge variant="secondary">Supprimé du NAS</Badge>
                      ) : (
                        <Badge variant="secondary">Pas sur NAS</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      {!item.onNas && !item.activeJobId && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={transfer.isPending}
                          onClick={() => transfer.mutate(item)}
                        >
                          {transfer.isPending && transfer.variables?.radarrId === item.radarrId ? (
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          ) : (
                            <Upload className="w-3 h-3 mr-1" />
                          )}
                          Transférer
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && !query.isLoading && (
              <p className="text-sm text-zinc-500 py-4">{emptyMessage}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SonarrTab() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'not_on_nas' | 'all'>('not_on_nas');
  const [search, setSearch] = useState('');

  const query = useQuery({
    queryKey: ['library-sonarr'],
    queryFn: () => api.getSonarrLibrary(),
    staleTime: 60_000,
  });

  const transfer = useMutation({
    mutationFn: (item: SonarrItem) =>
      api.triggerManualTransfer({
        sourcePath: item.sourcePath,
        fileName: item.fileName ?? undefined,
        fileSize: item.fileSize ?? undefined,
        tmdbId: item.seriesTmdbId ?? undefined,
        tmdbType: 'tv',
        seasonNumber: item.seasonNumber,
        episodeNumber: item.episodeNumber,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library-sonarr'] });
      queryClient.invalidateQueries({ queryKey: ['jobs-active'] });
    },
  });

  const totalWithFile = (query.data?.items ?? []).filter((i) => i.hasFile && i.sourcePath).length;
  const filtered: SonarrItem[] = useMemo(() => {
    const items = (query.data?.items ?? []).filter((i) => i.hasFile && i.sourcePath);
    return items
      .filter((i) => (filter === 'all' ? true : !i.onNas))
      .filter((i) =>
        search
          ? i.seriesTitle.toLowerCase().includes(search.toLowerCase()) ||
            (i.episodeTitle ?? '').toLowerCase().includes(search.toLowerCase())
          : true,
      )
      .sort((a, b) => {
        const t = a.seriesTitle.localeCompare(b.seriesTitle);
        if (t !== 0) return t;
        if (a.seasonNumber !== b.seasonNumber) return a.seasonNumber - b.seasonNumber;
        return a.episodeNumber - b.episodeNumber;
      });
  }, [query.data, filter, search]);
  const emptyMessage = totalWithFile === 0
    ? 'Aucun épisode téléchargé sur Sonarr (seuls ceux avec fichier sur la seedbox apparaissent ici).'
    : filter === 'not_on_nas'
      ? `Tous les épisodes Sonarr (${totalWithFile}) sont déjà sur le NAS.`
      : 'Aucun épisode correspondant.';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="flex items-center gap-2">
            {query.data ? `${filtered.length} épisode(s)` : 'Chargement...'}
            {query.isFetching && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />}
          </CardTitle>
          <div className="flex gap-2 items-center">
            <Input
              placeholder="Rechercher série/épisode..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56"
            />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as 'not_on_nas' | 'all')}
              className="bg-zinc-900 border border-zinc-800 text-zinc-200 rounded px-2 py-1 text-sm"
            >
              <option value="not_on_nas">Non sur NAS</option>
              <option value="all">Tous</option>
            </select>
            <Button size="sm" variant="outline" onClick={() => query.refetch()}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Rafraîchir
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {query.isError && (
          <p className="text-sm text-destructive">
            {query.error instanceof Error ? query.error.message : 'Erreur Sonarr'}
          </p>
        )}
        {query.isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-zinc-500 border-b border-zinc-800">
                  <th className="text-left py-2 pr-2">Série</th>
                  <th className="text-left py-2 pr-2">S/E</th>
                  <th className="text-left py-2 pr-2">Épisode</th>
                  <th className="text-left py-2 pr-2">Qualité</th>
                  <th className="text-left py-2 pr-2">Statut</th>
                  <th className="text-right py-2 pr-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.sonarrEpisodeId} className="border-b border-zinc-900 hover:bg-zinc-900/30">
                    <td className="py-2 pr-2 truncate max-w-[300px]">
                      <div>{item.seriesTitle}</div>
                      <div className="text-[10px] text-zinc-600 truncate">{item.sourcePath}</div>
                    </td>
                    <td className="py-2 pr-2 text-zinc-400 text-xs whitespace-nowrap">
                      S{String(item.seasonNumber).padStart(2, '0')}E{String(item.episodeNumber).padStart(2, '0')}
                    </td>
                    <td className="py-2 pr-2 truncate max-w-[260px] text-zinc-300">{item.episodeTitle ?? '—'}</td>
                    <td className="py-2 pr-2 text-zinc-400 text-xs">{item.quality ?? '—'}</td>
                    <td className="py-2 pr-2">
                      {item.onNas ? (
                        <Badge variant="success">Sur NAS</Badge>
                      ) : item.activeJobId ? (
                        <Badge variant="default">Job #{item.activeJobId}</Badge>
                      ) : (
                        <Badge variant="secondary">Pas sur NAS</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      {!item.onNas && !item.activeJobId && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={transfer.isPending}
                          onClick={() => transfer.mutate(item)}
                        >
                          {transfer.isPending && transfer.variables?.sonarrEpisodeId === item.sonarrEpisodeId ? (
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          ) : (
                            <Upload className="w-3 h-3 mr-1" />
                          )}
                          Transférer
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && !query.isLoading && (
              <p className="text-sm text-zinc-500 py-4">{emptyMessage}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
