import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { MediaCarousel } from '@/components/media/MediaCarousel';
import { Skeleton } from '@/components/ui/skeleton';
import useEmblaCarousel from 'embla-carousel-react';
import Autoplay from 'embla-carousel-autoplay';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Play, Info } from 'lucide-react';

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
    Autoplay({ delay: 6000, stopOnInteraction: true }),
  ]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on('select', onSelect);
    onSelect();
  }, [emblaApi, onSelect]);

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="relative mb-10" ref={containerRef}>
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex">
          {items.map((m) => (
            <div key={m.id} className="relative flex-[0_0_100%] h-[60vh] md:h-[82vh] overflow-hidden">
              {/* Parallax background */}
              <div
                className="absolute inset-x-0 -top-[20%] -bottom-[20%] bg-cover bg-center will-change-transform"
                style={{
                  backgroundImage: `url(${m.backdropUrl || ''})`,
                  transform: `translateY(${scrollY * 0.28}px)`,
                }}
              />
              {/* Gradients */}
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/50 to-zinc-950/10" />
              <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/85 via-zinc-950/20 to-transparent" />

              {/* Glass info panel */}
              <div className="relative h-full flex items-end pb-8 md:pb-14 px-3 md:px-12">
                <div className="w-full max-w-lg">
                  <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl md:rounded-2xl p-4 md:p-6 shadow-2xl">
                    <h1 className="text-xl md:text-4xl font-bold mb-2 md:mb-3 leading-tight line-clamp-2">
                      {m.titleVf || m.titleOriginal}
                    </h1>
                    {m.overview && (
                      <p className="hidden md:block text-sm text-zinc-300 line-clamp-3 mb-5 leading-relaxed">{m.overview}</p>
                    )}
                    <div className="flex items-center gap-1.5 mb-3 md:mb-5 flex-wrap">
                      {m.releaseYear && (
                        <span className="bg-white/10 backdrop-blur-sm border border-white/10 rounded-full px-2.5 py-0.5 text-xs text-zinc-300">
                          {m.releaseYear}
                        </span>
                      )}
                      {m.voteAverage && (
                        <span className="bg-yellow-500/15 backdrop-blur-sm border border-yellow-500/20 rounded-full px-2.5 py-0.5 text-xs text-yellow-400">
                          ★ {m.voteAverage.toFixed(1)}
                        </span>
                      )}
                      {m.runtime && (
                        <span className="bg-white/10 backdrop-blur-sm border border-white/10 rounded-full px-2.5 py-0.5 text-xs text-zinc-300">
                          {m.runtime} min
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Link
                        to={`/media/${m.id}`}
                        className="flex items-center gap-1.5 bg-white text-black font-semibold text-xs md:text-sm px-4 md:px-5 py-2 md:py-2.5 rounded-lg md:rounded-xl hover:bg-white/90 transition-colors"
                      >
                        <Play className="w-3.5 h-3.5 md:w-4 md:h-4 fill-black" />
                        Voir
                      </Link>
                      <Link
                        to={`/media/${m.id}`}
                        className="flex items-center gap-1.5 bg-white/10 backdrop-blur-sm border border-white/15 text-white text-xs md:text-sm px-4 md:px-5 py-2 md:py-2.5 rounded-lg md:rounded-xl hover:bg-white/20 transition-colors"
                      >
                        <Info className="w-3.5 h-3.5 md:w-4 md:h-4" />
                        Détails
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
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
            className={`h-1 rounded-full transition-all cursor-pointer ${i === selectedIndex ? 'w-8 bg-white' : 'w-2 bg-white/30 hover:bg-white/50'}`}
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
