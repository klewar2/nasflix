import { Link } from 'react-router';
import { ThumbsUp, ThumbsDown, Check } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RecommendationResponse, FeedbackVote } from '@nasflix/shared';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api-client';

interface RecommendationCardProps {
  reco: RecommendationResponse;
  className?: string;
}

export function RecommendationCard({ reco, className }: RecommendationCardProps) {
  const queryClient = useQueryClient();

  const voteMutation = useMutation<unknown, Error, { vote: FeedbackVote | null }>({
    mutationFn: ({ vote }) =>
      vote === null ? api.clearRecommendationFeedback(reco.id) : api.setRecommendationFeedback(reco.id, vote),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['recommendation', reco.id] });
    },
  });

  const handleVote = (e: React.MouseEvent, vote: FeedbackVote) => {
    e.preventDefault();
    e.stopPropagation();
    voteMutation.mutate({ vote: reco.userVote === vote ? null : vote });
  };

  return (
    <Link
      to={`/recommendation/${reco.id}`}
      className={cn(
        'group relative flex-shrink-0 overflow-hidden rounded-md transition-transform duration-300 hover:scale-105 hover:z-10',
        className,
      )}
    >
      <div className="aspect-[2/3] w-full">
        {reco.posterUrl ? (
          <img src={reco.posterUrl} alt={reco.title} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-zinc-800 text-zinc-500">
            <span className="text-center text-sm px-2">{reco.title}</span>
          </div>
        )}
      </div>

      {/* Badge "IA" en haut à gauche */}
      <div className="absolute left-1.5 top-1.5">
        <span className="text-[10px] font-semibold bg-primary/90 text-white px-1.5 py-0.5 rounded backdrop-blur-sm">
          IA
        </span>
      </div>

      {/* Vote actif en haut à droite (toujours visible) */}
      {reco.userVote && (
        <div className="absolute right-1.5 top-1.5">
          {reco.userVote === 'LIKE' && <ThumbsUp className="w-4 h-4 text-green-400 fill-green-400/30" />}
          {reco.userVote === 'DISLIKE' && <ThumbsDown className="w-4 h-4 text-red-400 fill-red-400/30" />}
          {reco.userVote === 'SEEN' && <Check className="w-4 h-4 text-blue-400" />}
        </div>
      )}

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100">
        <div className="absolute bottom-0 w-full p-3">
          <p className="text-sm font-semibold truncate">{reco.title}</p>
          <div className="flex items-center gap-2 text-xs text-zinc-400 mt-1">
            {reco.releaseDate && <span>{new Date(reco.releaseDate).getFullYear()}</span>}
            {reco.voteAverage && <span>★ {reco.voteAverage.toFixed(1)}</span>}
          </div>
          <div className="flex gap-1 mt-2">
            <button
              type="button"
              onClick={(e) => handleVote(e, 'LIKE')}
              className={cn(
                'flex-1 flex items-center justify-center py-1 rounded text-xs transition-colors',
                reco.userVote === 'LIKE' ? 'bg-green-500/30 text-green-300' : 'bg-white/10 hover:bg-white/20',
              )}
              disabled={voteMutation.isPending}
              title="J'aime"
            >
              <ThumbsUp className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={(e) => handleVote(e, 'DISLIKE')}
              className={cn(
                'flex-1 flex items-center justify-center py-1 rounded text-xs transition-colors',
                reco.userVote === 'DISLIKE' ? 'bg-red-500/30 text-red-300' : 'bg-white/10 hover:bg-white/20',
              )}
              disabled={voteMutation.isPending}
              title="Pas intéressé"
            >
              <ThumbsDown className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={(e) => handleVote(e, 'SEEN')}
              className={cn(
                'flex-1 flex items-center justify-center py-1 rounded text-xs transition-colors',
                reco.userVote === 'SEEN' ? 'bg-blue-500/30 text-blue-300' : 'bg-white/10 hover:bg-white/20',
              )}
              disabled={voteMutation.isPending}
              title="Déjà vu"
            >
              <Check className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </Link>
  );
}
