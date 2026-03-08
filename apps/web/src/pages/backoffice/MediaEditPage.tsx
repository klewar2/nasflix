import { useParams, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ArrowLeft, RefreshCw } from 'lucide-react';

export default function MediaEditPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();

  const { data: media, isLoading } = useQuery({
    queryKey: ['admin', 'media', id],
    queryFn: () => api.getMediaById(Number(id)),
    enabled: !!id,
  });

  const syncMutation = useMutation({
    mutationFn: () => api.syncSingleMedia(Number(id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'media', id] }),
  });

  if (isLoading) return <p className="text-zinc-500">Chargement...</p>;
  if (!media) return <p className="text-zinc-500">Média non trouvé</p>;

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link to="/admin/media"><ArrowLeft className="w-5 h-5 text-zinc-400 hover:text-white" /></Link>
        <h1 className="text-2xl font-bold">{media.titleVf || media.titleOriginal}</h1>
        <Badge variant={media.syncStatus === 'SYNCED' ? 'success' : 'warning'}>{media.syncStatus}</Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader><CardTitle>Métadonnées</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div><span className="text-zinc-500">Titre VF :</span> {media.titleVf || '-'}</div>
              <div><span className="text-zinc-500">Titre original :</span> {media.titleOriginal}</div>
              <div><span className="text-zinc-500">Type :</span> {media.type === 'MOVIE' ? 'Film' : 'Série'}</div>
              <div><span className="text-zinc-500">Année :</span> {media.releaseYear || '-'}</div>
              <div><span className="text-zinc-500">Durée :</span> {media.runtime ? `${media.runtime} min` : '-'}</div>
              <div><span className="text-zinc-500">Note :</span> {media.voteAverage ? `${media.voteAverage}/10` : '-'}</div>
              <div><span className="text-zinc-500">TMDB ID :</span> {media.tmdbId || '-'}</div>
              <div><span className="text-zinc-500">Synopsis :</span> {media.overview || '-'}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Fichier NAS</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><span className="text-zinc-500">Chemin :</span> <code className="text-xs bg-zinc-900 px-2 py-1 rounded">{media.nasPath}</code></div>
              <div><span className="text-zinc-500">Nom du fichier :</span> {media.nasFilename}</div>
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          {media.posterUrl && <img src={media.posterUrl} alt="" className="rounded-lg w-full" />}
          <Button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} className="w-full">
            <RefreshCw className="w-4 h-4 mr-2" />
            {syncMutation.isPending ? 'Synchronisation...' : 'Re-synchroniser'}
          </Button>
        </div>
      </div>
    </div>
  );
}
