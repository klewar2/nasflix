import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMedia } from '../lib/api';
import { KEY, useRemoteKeys } from '../hooks/useRemoteKeys';
import type { Screen } from '../App';

const ALPHABET = ['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
const COLS = 6;

type SortMode = 'recent' | 'alpha' | 'rating' | 'year';
type Zone = 'az' | 'sort' | 'genre' | 'grid';

interface Props {
  kind: 'movies' | 'series';
  navigate: (s: Screen) => void;
  navFocused: boolean;
  onFocusNav: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeMedia(m: any) {
  return {
    id: m.id as number,
    title: (m.titleVf || m.title || m.titleOriginal || 'Inconnu') as string,
    posterUrl: (m.posterUrl || (m.posterPath ? `https://image.tmdb.org/t/p/w300${m.posterPath}` : undefined)) as string | undefined,
    type: (m.type === 'SERIES' || m.type === 'series' ? 'series' : 'movie') as 'movie' | 'series',
    releaseYear: (m.releaseYear || (m.releaseDate ? new Date(m.releaseDate).getFullYear() : undefined)) as number | undefined,
    voteAverage: m.voteAverage as number | undefined,
    videoQuality: m.videoQuality as string | undefined,
    genres: (m.genres as Array<{ name: string }> | undefined)?.map((g) => g.name) ?? [],
  };
}

const SORT_OPTIONS: { id: SortMode; label: string }[] = [
  { id: 'recent', label: 'Récents' },
  { id: 'alpha', label: 'A → Z' },
  { id: 'rating', label: '★ Note' },
  { id: 'year', label: 'Année' },
];


export default function ListPage({ kind, navigate, navFocused, onFocusNav }: Props) {
  const [sort, setSort] = useState<SortMode>('recent');
  const [selectedGenre, setSelectedGenre] = useState<string>('Tous');
  const [focusedGenreIdx, setFocusedGenreIdx] = useState(0);
  const [focusedLetter, setFocusedLetter] = useState<string>('A');
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [zone, setZone] = useState<Zone>('grid');
  const gridRef = useRef<HTMLDivElement>(null);
  const focusedCardRef = useRef<HTMLDivElement>(null);
  const focusedLetterRef = useRef<HTMLDivElement>(null);
  const azRailRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['media', kind, 'all'],
    queryFn: () => getMedia({ type: kind === 'movies' ? 'movie' : 'series', limit: 300 }),
    staleTime: 5 * 60 * 1000,
  });

  const rawItems = (data?.data || []).map(normalizeMedia);

  const genreList = ['Tous', ...Array.from(new Set(rawItems.flatMap((m) => m.genres))).sort((a, b) => a.localeCompare(b, 'fr'))];

  const filteredItems = selectedGenre === 'Tous'
    ? rawItems
    : rawItems.filter((m) => m.genres.includes(selectedGenre));

  const sortedItems = [...filteredItems].sort((a, b) => {
    if (sort === 'alpha') return a.title.localeCompare(b.title, 'fr');
    if (sort === 'rating') return (b.voteAverage ?? 0) - (a.voteAverage ?? 0);
    if (sort === 'year') return (b.releaseYear ?? 0) - (a.releaseYear ?? 0);
    return 0;
  });

  const jumpToLetter = (letter: string) => {
    const idx = sortedItems.findIndex((m) => {
      const first = m.title.charAt(0).toUpperCase();
      if (letter === '#') return !/[A-Z]/.test(first);
      return first === letter;
    });
    if (idx >= 0) {
      setFocusedIdx(idx);
      setZone('grid');
    }
  };

  // Auto-scroll focused card/letter into view
  useEffect(() => {
    if (zone === 'grid') {
      focusedCardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    if (zone === 'az') {
      focusedLetterRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focusedIdx, zone, focusedLetter]);

  // Reset focus when kind changes
  useEffect(() => {
    setFocusedIdx(0);
    setZone('grid');
    setSort('recent');
    setSelectedGenre('Tous');
    setFocusedGenreIdx(0);
  }, [kind]);

  useRemoteKeys((e) => {
    if (navFocused) return;

    if (e.keyCode === KEY.BACK) {
      e.preventDefault();
      navigate({ name: 'home' });
      return;
    }

    if (zone === 'az') {
      e.preventDefault();
      const idx = ALPHABET.indexOf(focusedLetter);
      if (e.keyCode === KEY.UP) {
        if (idx > 0) setFocusedLetter(ALPHABET[idx - 1]);
        else onFocusNav();
      } else if (e.keyCode === KEY.DOWN) {
        if (idx < ALPHABET.length - 1) setFocusedLetter(ALPHABET[idx + 1]);
      } else if (e.keyCode === KEY.RIGHT) {
        setZone('grid');
      } else if (e.keyCode === KEY.OK) {
        jumpToLetter(focusedLetter);
      }
      return;
    }

    if (zone === 'sort') {
      e.preventDefault();
      const idx = SORT_OPTIONS.findIndex((s) => s.id === sort);
      if (e.keyCode === KEY.LEFT) {
        if (idx > 0) setSort(SORT_OPTIONS[idx - 1].id);
        else setZone('az');
      } else if (e.keyCode === KEY.RIGHT) {
        if (idx < SORT_OPTIONS.length - 1) setSort(SORT_OPTIONS[idx + 1].id);
      } else if (e.keyCode === KEY.UP) {
        onFocusNav();
      } else if (e.keyCode === KEY.DOWN) {
        setZone('genre');
        setFocusedGenreIdx(genreList.indexOf(selectedGenre));
      }
      return;
    }

    if (zone === 'genre') {
      e.preventDefault();
      if (e.keyCode === KEY.LEFT) {
        if (focusedGenreIdx > 0) setFocusedGenreIdx((i) => i - 1);
      } else if (e.keyCode === KEY.RIGHT) {
        if (focusedGenreIdx < genreList.length - 1) setFocusedGenreIdx((i) => i + 1);
      } else if (e.keyCode === KEY.UP) {
        setZone('sort');
      } else if (e.keyCode === KEY.DOWN) {
        setZone('grid');
        setFocusedIdx(0);
      } else if (e.keyCode === KEY.OK) {
        setSelectedGenre(genreList[focusedGenreIdx]);
        setFocusedIdx(0);
      }
      return;
    }

    // zone === 'grid'
    e.preventDefault();
    const row = Math.floor(focusedIdx / COLS);
    const col = focusedIdx % COLS;

    if (e.keyCode === KEY.UP) {
      if (row === 0) setZone('sort');
      else setFocusedIdx(focusedIdx - COLS);
    } else if (e.keyCode === KEY.DOWN) {
      const next = focusedIdx + COLS;
      if (next < sortedItems.length) setFocusedIdx(next);
    } else if (e.keyCode === KEY.LEFT) {
      if (col === 0) setZone('az');
      else setFocusedIdx(focusedIdx - 1);
    } else if (e.keyCode === KEY.RIGHT) {
      if (col < COLS - 1 && focusedIdx + 1 < sortedItems.length) setFocusedIdx(focusedIdx + 1);
    } else if (e.keyCode === KEY.OK) {
      const media = sortedItems[focusedIdx];
      if (media) navigate({ name: 'detail', mediaId: media.id, mediaType: media.type });
    }
  }, [zone, focusedLetter, focusedIdx, focusedGenreIdx, sort, selectedGenre, genreList, sortedItems, navigate, navFocused, onFocusNav]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Header bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '1rem',
        padding: '0.6rem 1.2rem 0.6rem 0.6rem',
        background: 'rgba(0,0,0,0.4)',
        borderBottom: '1px solid var(--line)',
        flexShrink: 0,
      }}>
        {/* Title + count (A-Z rail width offset) */}
        <div style={{ width: '88px', flexShrink: 0, paddingLeft: '0.6rem' }}>
          <h1 style={{
            fontFamily: 'var(--serif)',
            fontSize: '1.75rem', fontWeight: 400,
            lineHeight: 1, color: '#fff',
          }}>
            {kind === 'movies' ? 'Films' : 'Séries'}
          </h1>
          {data?.total !== undefined && (
            <div style={{
              fontFamily: 'var(--mono)',
              fontSize: '0.4rem', color: 'var(--text-muted)',
              letterSpacing: '0.1em', marginTop: '0.1rem',
            }}>
              {data.total} TITRES
            </div>
          )}
        </div>

        {/* Sort tabs in pill container */}
        <div style={{
          display: 'flex', alignItems: 'center',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--line-strong)',
          borderRadius: '4px',
          padding: '4px',
          gap: '2px',
        }}>
          {SORT_OPTIONS.map((opt) => {
            const isActive = sort === opt.id;
            const isFocused = zone === 'sort' && isActive;
            return (
              <button
                key={opt.id}
                data-focused={isFocused}
                onClick={() => { setSort(opt.id); setZone('sort'); }}
                style={{
                  padding: '6px 14px', borderRadius: '3px',
                  background: isActive ? 'var(--accent)' : 'transparent',
                  border: 'none',
                  color: isActive ? '#fff' : 'var(--text-muted)',
                  fontSize: '0.38rem', fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer',
                  outline: isFocused ? '2px solid var(--accent)' : 'none',
                  outlineOffset: '5px',
                  transition: 'all 0.12s ease',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Genre filter chips */}
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {genreList.map((g, i) => {
            const isSelected = g === selectedGenre;
            const isFocused = zone === 'genre' && focusedGenreIdx === i;
            return (
              <span
                key={g}
                onClick={() => { setSelectedGenre(g); setFocusedGenreIdx(i); setFocusedIdx(0); setZone('genre'); }}
                className={isSelected ? 'chip accent' : 'chip'}
                style={{
                  cursor: 'pointer',
                  outline: isFocused ? '2px solid var(--accent)' : 'none',
                  outlineOffset: '5px',
                }}
              >
                {g}
              </span>
            );
          })}
        </div>
      </div>

      {/* Main: A-Z rail + grid */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* A-Z rail */}
        <div
          ref={azRailRef}
          style={{
            width: '88px', flexShrink: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            overflowY: 'auto', paddingTop: '0.5rem', paddingBottom: '0.4rem',
            borderRight: '1px solid var(--line)',
            gap: '0.01rem',
          }}
        >
          <span style={{
            fontFamily: 'var(--mono)',
            fontSize: '9px', color: 'var(--text-dim)',
            letterSpacing: '0.15em', marginBottom: '0.35rem',
            textTransform: 'uppercase',
          }}>
            INDEX
          </span>
          {ALPHABET.map((letter) => {
            const isFocused = zone === 'az' && focusedLetter === letter;
            return (
              <div
                key={letter}
                ref={isFocused ? focusedLetterRef : undefined}
                data-focused={isFocused}
                onClick={() => { setFocusedLetter(letter); jumpToLetter(letter); setZone('az'); }}
                style={{
                  width: '1.6rem', height: '1.1rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: '3px',
                  fontFamily: 'var(--mono)',
                  fontSize: '0.44rem', fontWeight: 600,
                  color: isFocused ? '#fff' : 'var(--text-muted)',
                  background: isFocused ? 'var(--accent)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'all 0.1s ease',
                  outline: isFocused ? '2px solid var(--accent)' : 'none',
                  outlineOffset: '5px',
                }}
              >
                {letter}
              </div>
            );
          })}
        </div>

        {/* Grid */}
        <div ref={gridRef} style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 1rem 1rem' }}>
          {isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60%', color: 'var(--text-dim)', fontSize: '0.5rem' }}>
              Chargement…
            </div>
          ) : sortedItems.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60%', color: 'var(--text-dim)', fontSize: '0.5rem' }}>
              Aucun contenu disponible
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: '16px' }}>
              {sortedItems.map((media, idx) => {
                const isFocused = zone === 'grid' && focusedIdx === idx;
                return (
                  <div
                    key={media.id}
                    ref={isFocused ? focusedCardRef : undefined}
                    data-focused={isFocused}
                    onClick={() => navigate({ name: 'detail', mediaId: media.id, mediaType: media.type })}
                    style={{
                      borderRadius: '5px', overflow: 'hidden', cursor: 'pointer',
                      outline: isFocused ? '2px solid var(--accent)' : '2px solid transparent',
                      outlineOffset: '5px',
                      boxShadow: isFocused
                        ? '0 0 0 7px rgba(177,58,48,0.12), 0 20px 60px rgba(0,0,0,0.7)'
                        : '0 2px 8px rgba(0,0,0,0.5)',
                      transition: 'outline-color 0.15s ease, box-shadow 0.15s ease',
                      background: 'var(--bg-card)',
                      zIndex: isFocused ? 10 : 1,
                    }}
                  >
                    {/* Poster */}
                    <div style={{ aspectRatio: '2/3', position: 'relative' }}>
                      {media.posterUrl ? (
                        <img
                          src={media.posterUrl}
                          alt={media.title}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          loading="lazy"
                        />
                      ) : (
                        <div style={{
                          width: '100%', height: '100%', display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                          background: 'linear-gradient(135deg, #27272a, #18181b)',
                          color: 'var(--text-dim)', fontSize: '0.38rem',
                          padding: '0.4rem', textAlign: 'center',
                        }}>
                          {media.title}
                        </div>
                      )}
                      {media.videoQuality === '4K' && (
                        <span className="quality uhd" style={{
                          position: 'absolute', top: '0.2rem', right: '0.2rem',
                        }}>4K</span>
                      )}
                    </div>
                    {/* Label */}
                    <div style={{ padding: '0.25rem 0.3rem 0.3rem' }}>
                      <div style={{
                        fontFamily: 'var(--serif)',
                        fontSize: '0.5rem', fontWeight: 400,
                        color: isFocused ? '#fff' : 'var(--text)',
                        lineHeight: 1.2,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}>
                        {media.title}
                      </div>
                      <div style={{
                        fontFamily: 'var(--mono)',
                        fontSize: '0.34rem', color: 'var(--text-dim)', marginTop: '0.1rem',
                      }}>
                        {media.releaseYear}
                        {media.voteAverage && media.voteAverage > 0 && ` · ★ ${media.voteAverage.toFixed(1)}`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
