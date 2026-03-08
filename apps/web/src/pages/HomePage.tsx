import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { MediaCarousel } from '@/components/media/MediaCarousel';
import { Skeleton } from '@/components/ui/skeleton';
import useEmblaCarousel from 'embla-carousel-react';
import Autoplay from 'embla-carousel-autoplay';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';

export default function HomePage() {
  const { data: recentMedia, isLoading: loadingRecent } = useQuery({
    queryKey: ['media', 'recent'],
    queryFn: () => api.getRecentMedia(40),
  });

  const { data: movies } = useQuery({
    queryKey: ['media', 'movies'],
    queryFn: () => api.getMedia({ type: 'MOVIE', limit: 40 }),
  });

  const { data: series } = useQuery({
    queryKey: ['media', 'series'],
    queryFn: () => api.getMedia({ type: 'SERIES', limit: 40 }),
  });

  const { data: genres } = useQuery({
    queryKey: ['genres'],
    queryFn: () => api.getGenres(),
  });

  const { data: uhdMedia } = useQuery({
    queryKey: ['media', 'quality', 'UHD'],
    queryFn: () => api.getMediaByQuality('UHD', 40),
  });

  const { data: hdrMedia } = useQuery({
    queryKey: ['media', 'quality', 'HDR'],
    queryFn: () => api.getMediaByQuality('HDR', 40),
  });

  const { data: fhdMedia } = useQuery({
    queryKey: ['media', 'quality', 'FHD'],
    queryFn: () => api.getMediaByQuality('FHD', 40),
  });

  const heroItems = recentMedia?.slice(0, 8) || [];

  return (
    <div className="pb-10">
      {loadingRecent && <Skeleton className="h-[60vh] w-full mb-8" />}
      {heroItems.length > 0 && <HeroCarousel items={heroItems} />}

      {recentMedia && recentMedia.length > 0 && <MediaCarousel title="Dernièrement ajouté sur le NAS" media={recentMedia} />}
      {movies?.data && movies.data.length > 0 && <MediaCarousel title="Films" media={movies.data} />}
      {series?.data && series.data.length > 0 && <MediaCarousel title="Séries" media={series.data} />}
      {uhdMedia && uhdMedia.length > 0 && <MediaCarousel title="4K Ultra HD" media={uhdMedia} />}
      {hdrMedia && hdrMedia.length > 0 && <MediaCarousel title="HDR & Dolby Vision" media={hdrMedia} />}
      {fhdMedia && fhdMedia.length > 0 && <MediaCarousel title="Full HD" media={fhdMedia} />}

      {genres?.slice(0, 5).map((genre: any) => (
        <GenreCarousel key={genre.id} genre={genre} />
      ))}
    </div>
  );
}

function HeroCarousel({ items }: { items: any[] }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true }, [
    Autoplay({ delay: 5000, stopOnInteraction: true }),
  ]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on('select', onSelect);
    onSelect();
  }, [emblaApi, onSelect]);

  return (
    <div className="relative mb-8">
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex">
          {items.map((m) => (
            <div key={m.id} className="relative flex-[0_0_100%] h-[60vh]">
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: `url(${m.backdropUrl || ''})` }}
              >
                <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/50 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/80 to-transparent" />
              </div>
              <Link to={`/media/${m.id}`} className="relative h-full flex items-end pb-16 px-4 md:px-8 block">
                <div className="max-w-xl">
                  <h1 className="text-4xl font-bold mb-3 drop-shadow-lg">{m.titleVf || m.titleOriginal}</h1>
                  {m.overview && <p className="text-sm text-zinc-300 line-clamp-3 mb-4">{m.overview}</p>}
                  <div className="flex items-center gap-3 text-sm text-zinc-400">
                    {m.releaseYear && <span>{m.releaseYear}</span>}
                    {m.voteAverage && <span>★ {m.voteAverage.toFixed(1)}</span>}
                    {m.runtime && <span>{m.runtime} min</span>}
                  </div>
                </div>
              </Link>
            </div>
          ))}
        </div>
      </div>

      {/* Dot indicators */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10">
        {items.map((_, i) => (
          <button
            key={i}
            onClick={() => emblaApi?.scrollTo(i)}
            className={`h-1.5 rounded-full transition-all cursor-pointer ${i === selectedIndex ? 'w-6 bg-white' : 'w-1.5 bg-white/40'}`}
          />
        ))}
      </div>
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
