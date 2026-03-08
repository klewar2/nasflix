import useEmblaCarousel from 'embla-carousel-react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback } from 'react';
import { MediaCard } from './MediaCard';
import type { MediaResponse } from '@nasflix/shared';

interface MediaCarouselProps {
  title: string;
  media: MediaResponse[];
}

export function MediaCarousel({ title, media }: MediaCarouselProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: 'start',
    slidesToScroll: 4,
    containScroll: 'trimSnaps',
    dragFree: true,
  });

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

  if (media.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="text-xl font-bold mb-3 px-4 md:px-8">{title}</h2>
      <div className="group relative">
        <button
          onClick={scrollPrev}
          className="absolute left-0 top-0 bottom-0 z-10 w-10 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="overflow-hidden px-4 md:px-8" ref={emblaRef}>
          <div className="flex gap-2">
            {media.map((m) => (
              <MediaCard key={m.id} media={m} className="min-w-[140px] md:min-w-[180px] lg:min-w-[200px]" />
            ))}
          </div>
        </div>
        <button
          onClick={scrollNext}
          className="absolute right-0 top-0 bottom-0 z-10 w-10 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>
    </section>
  );
}
