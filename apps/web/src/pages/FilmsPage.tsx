import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { MediaCard } from '@/components/media/MediaCard';
import { Skeleton } from '@/components/ui/skeleton';

export default function FilmsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['media', 'films', 'all'],
    queryFn: () => api.getMedia({ type: 'MOVIE', limit: 100 }),
  });

  return (
    <div className="px-4 md:px-8 py-6">
      <h1 className="text-2xl font-bold mb-6">Films</h1>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {isLoading
          ? Array.from({ length: 18 }).map((_, i) => <Skeleton key={i} className="aspect-[2/3] rounded-md" />)
          : data?.data?.map((m: any) => <MediaCard key={m.id} media={m} />)}
      </div>
    </div>
  );
}
