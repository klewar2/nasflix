import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { api } from '@/lib/api-client';
import { RecommendationCarousel } from '@/components/media/RecommendationCarousel';
import { Skeleton } from '@/components/ui/skeleton';

export default function RecommendationsPage() {
  const { data: pastRecos, isLoading: loadingPast } = useQuery({
    queryKey: ['recommendations', 'PAST'],
    queryFn: () => api.getRecommendations('PAST'),
  });

  const { data: upcomingRecos, isLoading: loadingUpcoming } = useQuery({
    queryKey: ['recommendations', 'UPCOMING'],
    queryFn: () => api.getRecommendations('UPCOMING'),
  });

  const isLoading = loadingPast || loadingUpcoming;
  const hasRecos = (pastRecos?.length ?? 0) > 0 || (upcomingRecos?.length ?? 0) > 0;

  return (
    <div className="pb-10 pt-24 md:pt-28">
      <div className="px-3 md:px-8 mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-3">
          <Sparkles className="w-6 h-6 md:w-7 md:h-7 text-primary" />
          Recommandations IA
        </h1>
        <p className="text-sm text-zinc-400 mt-1">
          Sélectionnés par intelligence artificielle pour votre CineClub
        </p>
      </div>

      {isLoading && (
        <div className="px-3 md:px-8 space-y-4">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      )}

      {!isLoading && !hasRecos && (
        <div className="px-3 md:px-8">
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Sparkles className="w-10 h-10 text-zinc-600 mb-4" />
            <p className="text-zinc-400 text-sm">Aucune recommandation disponible pour le moment.</p>
          </div>
        </div>
      )}

      {pastRecos && pastRecos.length > 0 && (
        <RecommendationCarousel title="Recommandé pour votre CineClub" recommendations={pastRecos} />
      )}
      {upcomingRecos && upcomingRecos.length > 0 && (
        <RecommendationCarousel title="Bientôt disponible" recommendations={upcomingRecos} />
      )}
    </div>
  );
}
