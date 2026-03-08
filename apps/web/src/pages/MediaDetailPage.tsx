import { useParams, Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Copy, ExternalLink } from 'lucide-react';
import { useState } from 'react';

export default function MediaDetailPage() {
  const { id } = useParams();
  const [copied, setCopied] = useState(false);

  const { data: media, isLoading } = useQuery({
    queryKey: ['media', id],
    queryFn: () => api.getMediaById(Number(id)),
    enabled: !!id,
  });

  const copyPath = () => {
    if (media?.nasPath) {
      navigator.clipboard.writeText(media.nasPath);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isLoading) {
    return (
      <div className="px-4 md:px-8 py-6">
        <Skeleton className="h-[50vh] w-full rounded-xl mb-6" />
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
    );
  }

  if (!media) {
    return (
      <div className="px-4 md:px-8 py-20 text-center">
        <p className="text-zinc-500">Média non trouvé</p>
        <Link to="/" className="text-primary hover:underline mt-4 inline-block">Retour</Link>
      </div>
    );
  }

  const directors = media.cast?.filter((c: any) => c.role === 'director') || [];
  const actors = media.cast?.filter((c: any) => c.role === 'actor') || [];

  return (
    <div className="pb-10">
      <div className="relative h-[50vh] md:h-[60vh]">
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${media.backdropUrl || ''})` }}>
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-zinc-950/30" />
        </div>
        <Link to="/" className="absolute top-4 left-4 z-10 text-zinc-400 hover:text-white">
          <ArrowLeft className="w-6 h-6" />
        </Link>
      </div>

      <div className="px-4 md:px-8 -mt-32 relative z-10">
        <div className="flex flex-col md:flex-row gap-6">
          {media.posterUrl && (
            <img src={media.posterUrl} alt={media.titleVf || media.titleOriginal} className="w-48 rounded-lg shadow-2xl flex-shrink-0 hidden md:block" />
          )}
          <div className="flex-1">
            <h1 className="text-3xl md:text-4xl font-bold mb-2">{media.titleVf || media.titleOriginal}</h1>
            {media.titleVf && media.titleOriginal !== media.titleVf && (
              <p className="text-zinc-400 text-sm mb-3">{media.titleOriginal}</p>
            )}

            <div className="flex items-center gap-3 text-sm text-zinc-400 mb-4">
              <Badge variant="secondary">{media.type === 'MOVIE' ? 'Film' : 'Série'}</Badge>
              {media.releaseYear && <span>{media.releaseYear}</span>}
              {media.voteAverage && <span>★ {media.voteAverage.toFixed(1)}</span>}
              {media.runtime && <span>{media.runtime} min</span>}
            </div>

            <div className="flex gap-2 flex-wrap mb-4">
              {media.genres?.map((g: any) => (
                <Badge key={g.genre?.id || g.genreId} variant="outline">{g.genre?.name || g.name}</Badge>
              ))}
            </div>

            {media.overview && <p className="text-zinc-300 text-sm leading-relaxed max-w-2xl mb-6">{media.overview}</p>}

            {directors.length > 0 && (
              <p className="text-sm mb-2">
                <span className="text-zinc-500">Réalisateur : </span>
                {directors.map((d: any) => d.person?.name || d.name).join(', ')}
              </p>
            )}

            <div className="flex items-center gap-2 mt-4 p-3 bg-zinc-900 rounded-md border border-zinc-800">
              <code className="text-xs text-zinc-400 flex-1 truncate">{media.nasPath}</code>
              <button onClick={copyPath} className="text-zinc-500 hover:text-white flex-shrink-0">
                {copied ? <span className="text-xs text-green-400">Copié !</span> : <Copy className="w-4 h-4" />}
              </button>
            </div>

            {media.trailerUrl && (
              <a href={media.trailerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 mt-4 text-sm text-primary hover:underline">
                <ExternalLink className="w-4 h-4" /> Voir la bande-annonce
              </a>
            )}
          </div>
        </div>

        {actors.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-bold mb-4">Casting</h2>
            <div className="flex gap-4 overflow-x-auto pb-4">
              {actors.map((a: any) => (
                <div key={a.id} className="flex-shrink-0 w-28 text-center">
                  {a.person?.photoUrl ? (
                    <img src={a.person.photoUrl} alt={a.person.name} className="w-20 h-20 rounded-full mx-auto object-cover" />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-zinc-800 mx-auto" />
                  )}
                  <p className="text-xs mt-2 font-medium truncate">{a.person?.name}</p>
                  <p className="text-[10px] text-zinc-500 truncate">{a.character}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {media.seasons && media.seasons.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-bold mb-4">Saisons</h2>
            <div className="space-y-4">
              {media.seasons.map((season: any) => (
                <div key={season.id} className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
                  <div className="flex items-center gap-4">
                    {season.posterUrl && <img src={season.posterUrl} alt={season.name} className="w-16 rounded" />}
                    <div>
                      <h3 className="font-semibold">Saison {season.seasonNumber}</h3>
                      {season.name && <p className="text-sm text-zinc-400">{season.name}</p>}
                      {season.episodeCount && <p className="text-xs text-zinc-500">{season.episodeCount} épisodes</p>}
                    </div>
                  </div>
                  {season.episodes?.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {season.episodes.map((ep: any) => (
                        <div key={ep.id} className="flex justify-between items-center text-sm py-1 border-t border-zinc-800">
                          <span className="text-zinc-400">E{ep.episodeNumber}</span>
                          <span className="flex-1 mx-3 truncate">{ep.name || `Épisode ${ep.episodeNumber}`}</span>
                          {ep.runtime && <span className="text-zinc-500 text-xs">{ep.runtime} min</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
