import { useParams, Link, useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  ArrowLeft, RefreshCw, AlertTriangle, Save, ChevronDown, ChevronRight,
  Tv2, HardDrive, Clock, Calendar,
} from 'lucide-react';

const STATUS_LABELS: Record<string, string> = {
  SYNCED: 'Synchronisé', PENDING: 'En attente', SYNCING: 'En cours',
  FAILED: 'Erreur', NOT_FOUND: 'Introuvable',
};
const STATUS_VARIANTS: Record<string, any> = {
  SYNCED: 'success', PENDING: 'warning', SYNCING: 'secondary',
  FAILED: 'destructive', NOT_FOUND: 'destructive',
};

function formatRuntime(min: number | null | undefined) {
  if (!min) return null;
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${min % 60 > 0 ? String(min % 60).padStart(2, '0') : ''}`;
}

function formatAirDate(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function EpisodeRow({ ep, seasonNumber }: { ep: any; seasonNumber: number }) {
  const episodeId = `s${seasonNumber}e${ep.episodeNumber}`;
  const onNas = !!ep.nasPath;

  return (
    <div id={episodeId} className="flex gap-3 py-3 border-t border-zinc-800 first:border-t-0 scroll-mt-20">
      {/* Still */}
      <div className="flex-shrink-0">
        {ep.stillUrl ? (
          <img src={ep.stillUrl} alt="" className="w-24 h-14 object-cover rounded bg-zinc-800" />
        ) : (
          <div className="w-24 h-14 rounded bg-zinc-800 flex items-center justify-center">
            <Tv2 className="w-5 h-5 text-zinc-600" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono text-zinc-500">
                S{String(seasonNumber).padStart(2, '0')}E{String(ep.episodeNumber).padStart(2, '0')}
              </span>
              <span className="font-medium text-sm">{ep.name || `Épisode ${ep.episodeNumber}`}</span>
            </div>

            <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500 flex-wrap">
              {ep.airDate && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />{formatAirDate(ep.airDate)}
                </span>
              )}
              {ep.runtime && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />{formatRuntime(ep.runtime)}
                </span>
              )}
            </div>

            {ep.overview && (
              <p className="text-xs text-zinc-500 mt-1.5 line-clamp-2 leading-relaxed">{ep.overview}</p>
            )}

            {onNas && ep.nasFilename && (
              <p className="text-[10px] text-zinc-600 mt-1 font-mono truncate">{ep.nasFilename}</p>
            )}
          </div>

          {/* NAS status */}
          <div className="flex-shrink-0 pt-0.5">
            {onNas ? (
              <span className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/25">
                <HardDrive className="w-2.5 h-2.5" />NAS
              </span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-600 border border-zinc-700">absent</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SeasonSection({ season }: { season: any }) {
  const [open, setOpen] = useState(true);
  const onNasCount = season.episodes?.filter((e: any) => e.nasPath).length ?? 0;
  const totalCount = season.episodes?.length ?? season.episodeCount ?? 0;

  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden mb-3 last:mb-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-3 bg-zinc-900 hover:bg-zinc-800 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
          <span className="font-medium text-sm">{season.name || `Saison ${season.seasonNumber}`}</span>
          {season.airDate && (
            <span className="text-xs text-zinc-500">({new Date(season.airDate).getFullYear()})</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
            onNasCount === totalCount && totalCount > 0
              ? 'bg-green-500/15 text-green-400'
              : onNasCount > 0
              ? 'bg-yellow-500/15 text-yellow-400'
              : 'bg-zinc-800 text-zinc-500'
          }`}>
            <HardDrive className="w-2.5 h-2.5" />{onNasCount}/{totalCount}
          </span>
          {totalCount > 0 && <span className="text-xs text-zinc-500">{totalCount} ép.</span>}
        </div>
      </button>

      {open && (
        <div className="px-3 pb-1">
          {season.episodes?.length > 0
            ? season.episodes.map((ep: any) => (
                <EpisodeRow key={ep.id} ep={ep} seasonNumber={season.seasonNumber} />
              ))
            : <p className="py-4 text-xs text-zinc-600">Aucun épisode pour cette saison.</p>
          }
        </div>
      )}
    </div>
  );
}

export default function MediaEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const didScrollRef = useRef(false);

  const { data: media, isLoading } = useQuery({
    queryKey: ['admin', 'media', id],
    queryFn: () => api.getMediaById(Number(id)),
    enabled: !!id,
  });

  const [searchTitle, setSearchTitle] = useState('');
  const [tmdbIdInput, setTmdbIdInput] = useState('');
  const [releaseYearInput, setReleaseYearInput] = useState('');

  useEffect(() => {
    if (media) {
      setSearchTitle(media.titleOriginal || '');
      setTmdbIdInput(media.tmdbId ? String(media.tmdbId) : '');
      setReleaseYearInput(media.releaseYear ? String(media.releaseYear) : '');
    }
  }, [media]);

  // Scroll to episode anchor on load (e.g. #s6e7)
  useEffect(() => {
    if (!media || media.type !== 'SERIES' || didScrollRef.current) return;
    const hash = window.location.hash;
    if (!hash) return;
    didScrollRef.current = true;
    setTimeout(() => {
      const el = document.getElementById(hash.slice(1));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 400);
  }, [media]);

  const updateMutation = useMutation({
    mutationFn: (data: any) => api.updateMedia(Number(id), data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'media', id] }),
  });

  const syncMutation = useMutation({
    mutationFn: () => api.syncSingleMedia(Number(id)),
    onSuccess: (result: any) => {
      if (result?.redirectTo) {
        const { seriesId, season, episode } = result.redirectTo;
        navigate(`/admin/media/${seriesId}#s${season}e${episode}`);
      } else {
        queryClient.invalidateQueries({ queryKey: ['admin', 'media', id] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'media'] });
      }
    },
  });

  const handleSaveAndSync = async () => {
    const updateData: any = { titleOriginal: searchTitle, syncStatus: 'PENDING', syncError: null };
    if (tmdbIdInput.trim()) updateData.tmdbId = parseInt(tmdbIdInput.trim());
    if (releaseYearInput.trim()) updateData.releaseYear = parseInt(releaseYearInput.trim());
    await updateMutation.mutateAsync(updateData);
    await syncMutation.mutateAsync();
  };

  if (isLoading) return <p className="text-zinc-500">Chargement...</p>;
  if (!media) return <p className="text-zinc-500">Média non trouvé</p>;

  const isFailed = media.syncStatus === 'NOT_FOUND' || media.syncStatus === 'FAILED';
  const isPending = updateMutation.isPending || syncMutation.isPending;
  const isSeries = media.type === 'SERIES';
  const totalOnNas = isSeries
    ? media.seasons?.reduce((acc: number, s: any) => acc + (s.episodes?.filter((e: any) => e.nasPath).length ?? 0), 0) ?? 0
    : 0;

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link to="/admin/media"><ArrowLeft className="w-5 h-5 text-zinc-400 hover:text-white" /></Link>
        <h1 className="text-2xl font-bold truncate">{media.titleVf || media.titleOriginal}</h1>
        <Badge variant={STATUS_VARIANTS[media.syncStatus] ?? 'secondary'}>
          {STATUS_LABELS[media.syncStatus] ?? media.syncStatus}
        </Badge>
      </div>

      {isFailed && media.syncError && (
        <div className="mb-6 flex items-start gap-3 p-4 bg-red-950/30 border border-red-800/50 rounded-lg text-sm text-red-300">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-400" />
          <div>
            <p className="font-semibold text-red-200 mb-1">Erreur de synchronisation</p>
            <p>{media.syncError}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">

          {/* TMDB Search */}
          <Card>
            <CardHeader><CardTitle>Recherche TMDB</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-zinc-500">
                Modifiez ces champs si la synchronisation n'a pas trouvé le bon film/série.
                Si vous renseignez un TMDB ID, la recherche par titre sera ignorée.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Titre de recherche</label>
                  <Input value={searchTitle} onChange={(e) => setSearchTitle(e.target.value)} placeholder="Titre de recherche TMDB..." />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">TMDB ID (optionnel)</label>
                    <Input value={tmdbIdInput} onChange={(e) => setTmdbIdInput(e.target.value.replace(/\D/g, ''))} placeholder="ex: 550" type="number" min="1" />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Année de sortie (optionnel)</label>
                    <Input value={releaseYearInput} onChange={(e) => setReleaseYearInput(e.target.value.replace(/\D/g, ''))} placeholder="ex: 2023" type="number" min="1900" max="2100" />
                  </div>
                </div>
              </div>
              <Button onClick={handleSaveAndSync} disabled={isPending || !searchTitle.trim()} className="w-full">
                {isPending
                  ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />En cours...</>
                  : <><Save className="w-4 h-4 mr-2" />Enregistrer et re-synchroniser</>
                }
              </Button>
              {syncMutation.isSuccess && !(syncMutation.data as any)?.redirectTo && (
                <p className="text-sm text-green-400">Re-synchronisation terminée !</p>
              )}
              {syncMutation.isError && (
                <p className="text-sm text-red-400">Erreur lors de la re-synchronisation</p>
              )}
            </CardContent>
          </Card>

          {/* Metadata */}
          <Card>
            <CardHeader><CardTitle>Métadonnées</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div><span className="text-zinc-500">Titre VF :</span> <span className="ml-2">{media.titleVf || '-'}</span></div>
              <div><span className="text-zinc-500">Titre original :</span> <span className="ml-2">{media.titleOriginal}</span></div>
              <div><span className="text-zinc-500">Type :</span> <span className="ml-2">{isSeries ? 'Série' : 'Film'}</span></div>
              <div><span className="text-zinc-500">Année :</span> <span className="ml-2">{media.releaseYear || '-'}</span></div>
              <div><span className="text-zinc-500">Durée :</span> <span className="ml-2">{media.runtime ? `${media.runtime} min` : '-'}</span></div>
              <div><span className="text-zinc-500">Note :</span> <span className="ml-2">{media.voteAverage ? `${media.voteAverage.toFixed(1)}/10` : '-'}</span></div>
              <div><span className="text-zinc-500">TMDB ID :</span> <span className="ml-2">{media.tmdbId || '-'}</span></div>
              {isSeries && media.seasons && (
                <div>
                  <span className="text-zinc-500">Épisodes sur NAS :</span>
                  <span className="ml-2">{totalOnNas} épisode(s) sur {media.seasons.length} saison(s)</span>
                </div>
              )}
              {media.overview && (
                <div><span className="text-zinc-500">Synopsis :</span> <p className="mt-1 text-zinc-300 text-xs leading-relaxed">{media.overview}</p></div>
              )}
            </CardContent>
          </Card>

          {/* NAS file */}
          <Card>
            <CardHeader><CardTitle>Fichier NAS</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><span className="text-zinc-500">Chemin :</span> <code className="ml-2 text-xs bg-zinc-900 px-2 py-1 rounded break-all">{media.nasPath}</code></div>
              <div><span className="text-zinc-500">Nom du fichier :</span> <span className="ml-2">{media.nasFilename}</span></div>
              <div className="flex flex-wrap gap-2 mt-2">
                {media.videoQuality && (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded border ${media.videoQuality === '4K' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' : 'bg-blue-500/20 text-blue-400 border-blue-500/30'}`}>
                    {media.videoQuality === '4K' ? '4K UHD' : media.videoQuality}
                  </span>
                )}
                {media.dolbyVision && <span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-600/30 text-blue-300 border border-blue-500/30">Dolby Vision</span>}
                {media.hdr && !media.dolbyVision && <span className="text-xs font-bold px-2 py-0.5 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30">HDR</span>}
                {media.dolbyAtmos && <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">Dolby Atmos</span>}
                {media.audioFormat && !media.dolbyAtmos && <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">{media.audioFormat}</span>}
              </div>
            </CardContent>
          </Card>

          {/* Seasons & Episodes */}
          {isSeries && media.seasons?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Tv2 className="w-4 h-4" />
                  Saisons & Épisodes
                </CardTitle>
              </CardHeader>
              <CardContent>
                {media.seasons.map((season: any) => (
                  <SeasonSection key={season.id} season={season} />
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {media.posterUrl && <img src={media.posterUrl} alt="" className="rounded-lg w-full" />}

          <Button variant="outline" onClick={() => syncMutation.mutate()} disabled={isPending} className="w-full">
            <RefreshCw className={`w-4 h-4 mr-2 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
            Re-synchroniser
          </Button>

          {/* Season progress bars */}
          {isSeries && media.seasons?.length > 0 && (
            <div className="text-xs text-zinc-500 space-y-2 p-3 bg-zinc-900 rounded-lg">
              <p className="font-medium text-zinc-400 mb-2">Progression NAS</p>
              {media.seasons.map((s: any) => {
                const onNas = s.episodes?.filter((e: any) => e.nasPath).length ?? 0;
                const total = s.episodes?.length ?? s.episodeCount ?? 0;
                const pct = total > 0 ? Math.round((onNas / total) * 100) : 0;
                return (
                  <div key={s.id}>
                    <div className="flex justify-between mb-1">
                      <span className="truncate mr-2">{s.name || `Saison ${s.seasonNumber}`}</span>
                      <span className={`flex-shrink-0 ${onNas === total && total > 0 ? 'text-green-400' : ''}`}>{onNas}/{total}</span>
                    </div>
                    <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${onNas === total && total > 0 ? 'bg-green-500' : 'bg-primary'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
