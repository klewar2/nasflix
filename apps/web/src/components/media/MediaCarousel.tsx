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
    slidesToScroll: 'auto',
    containScroll: 'trimSnaps',
    dragFree: true,
  });

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

  if (media.length === 0) return null;

  return (
    <section className="mb-6 md:mb-8">
      <h2 className="text-base md:text-xl font-bold mb-2 md:mb-3 px-3 md:px-8 inline-flex items-center gap-2">
        <span className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl px-3 md:px-4 py-1 md:py-1.5">{title}</span>
      </h2>
      <div className="group relative">
        <button
          onClick={scrollPrev}
          className="hidden md:flex absolute left-0 top-0 bottom-0 z-10 w-10 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity items-center justify-center cursor-pointer"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="overflow-hidden px-3 md:px-8" ref={emblaRef}>
          <div className="flex gap-2">
            {media.map((m) => (
              <MediaCard
                key={m.id}
                media={m}
                className="w-[42%] sm:w-[30%] md:w-[23%] lg:w-[calc(20%-7px)] flex-shrink-0"
              />
            ))}
          </div>
        </div>
        <button
          onClick={scrollNext}
          className="hidden md:flex absolute right-0 top-0 bottom-0 z-10 w-10 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity items-center justify-center cursor-pointer"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>
    </section>
  );
}
