import { useParams, Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Sparkles, ThumbsUp, ThumbsDown, Check } from 'lucide-react';
import { useMemo } from 'react';
import type { FeedbackVote } from '@nasflix/shared';
import { api } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

function youtubeEmbedUrl(trailerUrl: string | null): string | null {
  if (!trailerUrl) return null;
  const match = trailerUrl.match(/[?&]v=([^&]+)/) || trailerUrl.match(/youtu\.be\/([^?]+)/);
  return match ? `https://www.youtube.com/embed/${match[1]}` : null;
}

export default function RecommendationDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const recoId = id ? parseInt(id, 10) : NaN;

  const { data: reco, isLoading } = useQuery({
    queryKey: ['recommendation', recoId],
    queryFn: () => api.getRecommendation(recoId),
    enabled: !isNaN(recoId),
  });

  const voteMutation = useMutation<unknown, Error, { vote: FeedbackVote | null }>({
    mutationFn: ({ vote }) =>
      vote === null ? api.clearRecommendationFeedback(recoId) : api.setRecommendationFeedback(recoId, vote),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recommendation', recoId] });
      queryClient.invalidateQueries({ queryKey: ['recommendations'] });
    },
  });

  const trailer = useMemo(() => youtubeEmbedUrl(reco?.trailerUrl ?? null), [reco?.trailerUrl]);

  if (isLoading || !reco) {
    return (
      <div className="px-3 md:px-12 pt-6">
        <Skeleton className="h-[40vh] w-full" />
      </div>
    );
  }

  const handleVote = (vote: FeedbackVote) => {
    voteMutation.mutate({ vote: reco.userVote === vote ? null : vote });
  };

  const tmdbExternalUrl = `https://www.themoviedb.org/${reco.tmdbType === 'MOVIE' ? 'movie' : 'tv'}/${reco.tmdbId}`;

  return (
    <div className="pb-10">
      {/* Backdrop hero */}
      <div className="relative h-[40vh] md:h-[55vh] overflow-hidden">
        {reco.backdropUrl ? (
          <img src={reco.backdropUrl} alt={reco.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-zinc-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-zinc-950/20" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 gap-2 bg-black/40 backdrop-blur-md border-white/20"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour
        </Button>
      </div>

      {/* Content */}
      <div className="px-3 md:px-12 -mt-20 md:-mt-28 relative">
        <div className="flex flex-col md:flex-row gap-6">
          {reco.posterUrl && (
            <img
              src={reco.posterUrl}
              alt={reco.title}
              className="w-40 md:w-56 rounded-lg shadow-2xl flex-shrink-0"
            />
          )}
          <div className="flex-1 pt-2 md:pt-16">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-xs font-semibold text-primary uppercase tracking-wide">
                Recommandation IA
              </span>
            </div>
            <h1 className="text-2xl md:text-4xl font-bold mb-3">{reco.title}</h1>

            <div className="flex items-center gap-2 flex-wrap mb-4">
              <Badge variant="secondary">{reco.tmdbType === 'MOVIE' ? 'Film' : 'Série'}</Badge>
              {reco.releaseDate && (
                <Badge variant="outline">{new Date(reco.releaseDate).toLocaleDateString('fr-FR')}</Badge>
              )}
              {reco.voteAverage !== null && (
                <Badge variant="outline" className="text-yellow-400">
                  ★ {reco.voteAverage.toFixed(1)}
                </Badge>
              )}
              {reco.genres.slice(0, 3).map((g) => (
                <Badge key={g} variant="outline">
                  {g}
                </Badge>
              ))}
            </div>

            {reco.overview && (
              <p className="text-sm md:text-base text-zinc-300 leading-relaxed mb-6 max-w-3xl">{reco.overview}</p>
            )}

            {/* Boutons feedback */}
            <div className="flex gap-2 mb-6 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleVote('LIKE')}
                disabled={voteMutation.isPending}
                className={cn('gap-2', reco.userVote === 'LIKE' && 'bg-green-500/20 border-green-500/50 text-green-300')}
              >
                <ThumbsUp className="w-4 h-4" />
                J'aime
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleVote('DISLIKE')}
                disabled={voteMutation.isPending}
                className={cn('gap-2', reco.userVote === 'DISLIKE' && 'bg-red-500/20 border-red-500/50 text-red-300')}
              >
                <ThumbsDown className="w-4 h-4" />
                Pas intéressé
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleVote('SEEN')}
                disabled={voteMutation.isPending}
                className={cn('gap-2', reco.userVote === 'SEEN' && 'bg-blue-500/20 border-blue-500/50 text-blue-300')}
              >
                <Check className="w-4 h-4" />
                Déjà vu
              </Button>
              <a href={tmdbExternalUrl} target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm" className="gap-2">
                  <ExternalLink className="w-4 h-4" />
                  TMDB
                </Button>
              </a>
            </div>
          </div>
        </div>

        {/* Pourquoi cette reco */}
        <section className="mt-10 max-w-4xl">
          <h2 className="text-lg md:text-xl font-bold mb-3 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Pourquoi cette recommandation
          </h2>
          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-4 md:p-5">
            <p className="text-sm md:text-base text-zinc-300 leading-relaxed italic">{reco.reasonText}</p>
          </div>
        </section>

        {/* Bande-annonce */}
        {trailer && (
          <section className="mt-10 max-w-4xl">
            <h2 className="text-lg md:text-xl font-bold mb-3">Bande-annonce</h2>
            <div className="relative aspect-video w-full rounded-xl overflow-hidden border border-white/10">
              <iframe
                src={trailer}
                title={`Bande-annonce ${reco.title}`}
                className="absolute inset-0 w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </section>
        )}

        {!trailer && reco.trailerUrl && (
          <section className="mt-10">
            <Link to={reco.trailerUrl} target="_blank" className="text-sm text-primary hover:underline">
              Voir la bande-annonce sur YouTube →
            </Link>
          </section>
        )}
      </div>
    </div>
  );
}
