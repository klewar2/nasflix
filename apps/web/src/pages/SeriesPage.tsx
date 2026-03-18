import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, LayoutGrid } from 'lucide-react';
import { api } from '@/lib/api-client';
import { MediaCard } from '@/components/media/MediaCard';
import { Skeleton } from '@/components/ui/skeleton';
import { AlphaIndexBar } from '@/components/media/AlphaIndexBar';
import { cn } from '@/lib/utils';

function getAlphaKey(title: string): string {
  const upper = title.trim().toUpperCase();
  const withoutArticle = upper
    .replace(/^(LE |LA |LES |L'|UN |UNE |DES |THE |AN |A )/, '')
    .trim();
  const normalized = withoutArticle.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const first = normalized.charAt(0);
  if (/[0-9]/.test(first)) return '#';
  if (/[A-Z]/.test(first)) return first;
  return '#';
}

function groupByLetter(items: any[]): Record<string, any[]> {
  const groups: Record<string, any[]> = {};
  for (const item of items) {
    const key = getAlphaKey(item.titleVf || item.titleOriginal || '');
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}

export default function SeriesPage() {
  const [viewMode, setViewMode] = useState<'recent' | 'alpha'>('recent');
  const [activeGenreId, setActiveGenreId] = useState<number | null>(null);
  const [activeLetter, setActiveLetter] = useState<string | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['media', 'series', 'all'],
    queryFn: () => api.getMedia({ type: 'SERIES', limit: 500 }),
  });

  const series = data?.data ?? [];

  // Compute genres from loaded series
  const genres = useMemo(() => {
    const seen = new Set<number>();
    const result: { id: number; name: string }[] = [];
    for (const m of series) {
      for (const g of m.genres ?? []) {
        const id = g.genre?.id ?? g.genreId;
        const name = g.genre?.name ?? g.name;
        if (id && name && !seen.has(id)) {
          seen.add(id);
          result.push({ id, name });
        }
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [series]);

  // Apply genre filter
  const filteredSeries = useMemo(() => {
    if (activeGenreId === null) return series;
    return series.filter((m: any) =>
      (m.genres ?? []).some(
        (g: any) => (g.genre?.id ?? g.genreId) === activeGenreId,
      ),
    );
  }, [series, activeGenreId]);

  const sortedSeries = useMemo(
    () =>
      [...filteredSeries].sort((a, b) => {
        const ka = getAlphaKey(a.titleVf || a.titleOriginal || '');
        const kb = getAlphaKey(b.titleVf || b.titleOriginal || '');
        if (ka !== kb) return ka < kb ? -1 : 1;
        return (a.titleVf || a.titleOriginal || '').localeCompare(
          b.titleVf || b.titleOriginal || '',
          'fr',
        );
      }),
    [filteredSeries],
  );

  const groups = useMemo(() => groupByLetter(sortedSeries), [sortedSeries]);
  const availableLetters = useMemo(() => new Set(Object.keys(groups)), [groups]);
  const sortedLetterKeys = useMemo(
    () => ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')].filter((l) => availableLetters.has(l)),
    [availableLetters],
  );

  useEffect(() => {
    if (viewMode !== 'alpha' || sortedLetterKeys.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const letter = (entry.target as HTMLElement).dataset.letter;
            if (letter) setActiveLetter(letter);
          }
        }
      },
      { rootMargin: '-80px 0px -55% 0px', threshold: 0 },
    );
    Object.values(sectionRefs.current).forEach((el) => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [viewMode, sortedLetterKeys.join(',')]);

  const scrollToLetter = useCallback((letter: string) => {
    const el = sectionRefs.current[letter];
    if (el) {
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 130, behavior: 'smooth' });
    }
    setActiveLetter(letter);
  }, []);

  return (
    <div>
      {/* Header */}
      <div className="px-4 md:px-8 pt-8 pb-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-black tracking-tight">Séries</h1>
          {!isLoading && (
            <span className="text-sm text-zinc-400 bg-zinc-800/80 border border-zinc-700/50 px-2.5 py-0.5 rounded-full tabular-nums">
              {filteredSeries.length}
              {activeGenreId !== null && (
                <span className="text-zinc-600"> / {series.length}</span>
              )}
            </span>
          )}
        </div>

        {/* View toggle */}
        <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-1 gap-1">
          <button
            onClick={() => setViewMode('recent')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200',
              viewMode === 'recent' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            <Clock className="w-3.5 h-3.5" />
            Récent
          </button>
          <button
            onClick={() => setViewMode('alpha')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200',
              viewMode === 'alpha' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            A → Z
          </button>
        </div>
      </div>

      {/* Genre filter */}
      {!isLoading && genres.length > 0 && (
        <div className="px-4 md:px-8 pb-3">
          <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
            <button
              onClick={() => setActiveGenreId(null)}
              className={cn(
                'flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all duration-200',
                activeGenreId === null
                  ? 'bg-[#e50914] border-[#e50914] text-white shadow-md shadow-red-900/40'
                  : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white',
              )}
            >
              Tous
            </button>
            {genres.map((g) => (
              <button
                key={g.id}
                onClick={() => setActiveGenreId(activeGenreId === g.id ? null : g.id)}
                className={cn(
                  'flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all duration-200',
                  activeGenreId === g.id
                    ? 'bg-[#e50914] border-[#e50914] text-white shadow-md shadow-red-900/40'
                    : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white',
                )}
              >
                {g.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Alpha index bar */}
      {viewMode === 'alpha' && !isLoading && (
        <AlphaIndexBar
          availableLetters={availableLetters}
          activeLetter={activeLetter}
          onLetterClick={scrollToLetter}
        />
      )}

      {/* Content */}
      <div className="px-4 md:px-8 py-6">
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {Array.from({ length: 18 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[2/3] rounded-md" />
            ))}
          </div>
        ) : filteredSeries.length === 0 ? (
          <p className="text-zinc-600 text-sm py-12 text-center">Aucune série dans cette catégorie.</p>
        ) : viewMode === 'recent' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {filteredSeries.map((m: any) => (
              <MediaCard key={m.id} media={m} />
            ))}
          </div>
        ) : (
          <div className="space-y-12">
            {sortedLetterKeys.map((letter) => (
              <section
                key={letter}
                id={`section-${letter}`}
                data-letter={letter}
                ref={(el) => { sectionRefs.current[letter] = el; }}
              >
                <div className="flex items-center gap-4 mb-5">
                  <span
                    className="text-6xl font-black leading-none select-none"
                    style={{
                      color: 'transparent',
                      WebkitTextStroke: '2px #e50914',
                      textShadow: '0 0 40px rgba(229,9,20,0.3)',
                    }}
                  >
                    {letter}
                  </span>
                  <div className="flex-1 h-px bg-gradient-to-r from-zinc-700 to-transparent" />
                  <span className="text-xs text-zinc-600 font-medium tabular-nums">{groups[letter].length}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3">
                  {groups[letter].map((m: any) => (
                    <MediaCard key={m.id} media={m} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
