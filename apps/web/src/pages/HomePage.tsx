import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { MediaCarousel } from '@/components/media/MediaCarousel';
import { Skeleton } from '@/components/ui/skeleton';

export default function HomePage() {
  const { data: recentMedia, isLoading: loadingRecent } = useQuery({
    queryKey: ['media', 'recent'],
    queryFn: () => api.getRecentMedia(20),
  });

  const { data: movies } = useQuery({
    queryKey: ['media', 'movies'],
    queryFn: () => api.getMedia({ type: 'MOVIE', limit: 20 }),
  });

  const { data: series } = useQuery({
    queryKey: ['media', 'series'],
    queryFn: () => api.getMedia({ type: 'SERIES', limit: 20 }),
  });

  const { data: genres } = useQuery({
    queryKey: ['genres'],
    queryFn: () => api.getGenres(),
  });

  return (
    <div className="pb-10">
      {recentMedia && recentMedia.length > 0 && (
        <div className="relative h-[60vh] mb-8">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${recentMedia[0].backdropUrl || ''})` }}
          >
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/50 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/80 to-transparent" />
          </div>
          <div className="relative h-full flex items-end pb-16 px-4 md:px-8">
            <div className="max-w-xl">
              <h1 className="text-4xl font-bold mb-3">{recentMedia[0].titleVf || recentMedia[0].titleOriginal}</h1>
              <p className="text-sm text-zinc-300 line-clamp-3 mb-4">{recentMedia[0].overview}</p>
              <div className="flex items-center gap-3 text-sm text-zinc-400">
                {recentMedia[0].releaseYear && <span>{recentMedia[0].releaseYear}</span>}
                {recentMedia[0].voteAverage && <span>★ {recentMedia[0].voteAverage.toFixed(1)}</span>}
                {recentMedia[0].runtime && <span>{recentMedia[0].runtime} min</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {loadingRecent && (
        <div className="px-4 md:px-8 mb-8">
          <Skeleton className="h-8 w-48 mb-4" />
          <div className="flex gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="min-w-[180px] aspect-[2/3] rounded-md" />
            ))}
          </div>
        </div>
      )}

      {recentMedia && <MediaCarousel title="Dernièrement ajouté" media={recentMedia} />}
      {movies?.data && <MediaCarousel title="Films" media={movies.data} />}
      {series?.data && <MediaCarousel title="Séries" media={series.data} />}

      {genres?.slice(0, 5).map((genre: any) => (
        <GenreCarousel key={genre.id} genre={genre} />
      ))}
    </div>
  );
}

function GenreCarousel({ genre }: { genre: { id: number; name: string } }) {
  const { data: media } = useQuery({
    queryKey: ['media', 'genre', genre.id],
    queryFn: () => api.getMedia({ genreId: genre.id, limit: 20 }),
  });

  if (!media?.data?.length) return null;
  return <MediaCarousel title={genre.name} media={media.data} />;
}
