import { useParams, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ArrowLeft, RefreshCw, AlertTriangle, Save } from 'lucide-react';

const STATUS_LABELS: Record<string, string> = {
  SYNCED: 'Synchronisé', PENDING: 'En attente', SYNCING: 'En cours',
  FAILED: 'Erreur', NOT_FOUND: 'Introuvable',
};
const STATUS_VARIANTS: Record<string, any> = {
  SYNCED: 'success', PENDING: 'warning', SYNCING: 'secondary',
  FAILED: 'destructive', NOT_FOUND: 'destructive',
};

export default function MediaEditPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();

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

  const updateMutation = useMutation({
    mutationFn: (data: any) => api.updateMedia(Number(id), data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'media', id] }),
  });

  const syncMutation = useMutation({
    mutationFn: () => api.syncSingleMedia(Number(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'media', id] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'media'] });
    },
  });

  const handleSaveAndSync = async () => {
    const updateData: any = {
      titleOriginal: searchTitle,
      syncStatus: 'PENDING',
      syncError: null,
    };
    if (tmdbIdInput.trim()) updateData.tmdbId = parseInt(tmdbIdInput.trim());
    if (releaseYearInput.trim()) updateData.releaseYear = parseInt(releaseYearInput.trim());
    await updateMutation.mutateAsync(updateData);
    await syncMutation.mutateAsync();
  };

  if (isLoading) return <p className="text-zinc-500">Chargement...</p>;
  if (!media) return <p className="text-zinc-500">Média non trouvé</p>;

  const isFailed = media.syncStatus === 'NOT_FOUND' || media.syncStatus === 'FAILED';
  const isPending = updateMutation.isPending || syncMutation.isPending;

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link to="/admin/media"><ArrowLeft className="w-5 h-5 text-zinc-400 hover:text-white" /></Link>
        <h1 className="text-2xl font-bold truncate">{media.titleVf || media.titleOriginal}</h1>
        <Badge variant={STATUS_VARIANTS[media.syncStatus] ?? 'secondary'}>
          {STATUS_LABELS[media.syncStatus] ?? media.syncStatus}
        </Badge>
      </div>

      {/* Error banner */}
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

          {/* Edit fields */}
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
                  <Input
                    value={searchTitle}
                    onChange={(e) => setSearchTitle(e.target.value)}
                    placeholder="Titre de recherche TMDB..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">TMDB ID (optionnel)</label>
                    <Input
                      value={tmdbIdInput}
                      onChange={(e) => setTmdbIdInput(e.target.value.replace(/\D/g, ''))}
                      placeholder="ex: 550"
                      type="number"
                      min="1"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Année de sortie (optionnel)</label>
                    <Input
                      value={releaseYearInput}
                      onChange={(e) => setReleaseYearInput(e.target.value.replace(/\D/g, ''))}
                      placeholder="ex: 2023"
                      type="number"
                      min="1900"
                      max="2100"
                    />
                  </div>
                </div>
              </div>

              <Button
                onClick={handleSaveAndSync}
                disabled={isPending || !searchTitle.trim()}
                className="w-full"
              >
                {isPending ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />En cours...</>
                ) : (
                  <><Save className="w-4 h-4 mr-2" />Enregistrer et re-synchroniser</>
                )}
              </Button>

              {syncMutation.isSuccess && (
                <p className="text-sm text-green-400">Re-synchronisation terminée !</p>
              )}
              {syncMutation.isError && (
                <p className="text-sm text-red-400">Erreur lors de la re-synchronisation</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Métadonnées</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div><span className="text-zinc-500">Titre VF :</span> <span className="ml-2">{media.titleVf || '-'}</span></div>
              <div><span className="text-zinc-500">Titre original :</span> <span className="ml-2">{media.titleOriginal}</span></div>
              <div><span className="text-zinc-500">Type :</span> <span className="ml-2">{media.type === 'MOVIE' ? 'Film' : 'Série'}</span></div>
              <div><span className="text-zinc-500">Année :</span> <span className="ml-2">{media.releaseYear || '-'}</span></div>
              <div><span className="text-zinc-500">Durée :</span> <span className="ml-2">{media.runtime ? `${media.runtime} min` : '-'}</span></div>
              <div><span className="text-zinc-500">Note :</span> <span className="ml-2">{media.voteAverage ? `${media.voteAverage}/10` : '-'}</span></div>
              <div><span className="text-zinc-500">TMDB ID :</span> <span className="ml-2">{media.tmdbId || '-'}</span></div>
              {media.overview && <div><span className="text-zinc-500">Synopsis :</span> <p className="mt-1 text-zinc-300 text-xs leading-relaxed">{media.overview}</p></div>}
            </CardContent>
          </Card>

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
        </div>

        <div className="space-y-4">
          {media.posterUrl && <img src={media.posterUrl} alt="" className="rounded-lg w-full" />}
          <Button
            variant="outline"
            onClick={() => syncMutation.mutate()}
            disabled={isPending}
            className="w-full"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
            Re-synchroniser
          </Button>
        </div>
      </div>
    </div>
  );
}
