import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KEY, useRemoteKeys } from '../hooks/useRemoteKeys';
import { searchMedia } from '../lib/api';
import type { Screen } from '../App';

interface Props {
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
  };
}

export default function SearchPage({ navigate, navFocused, onFocusNav }: Props) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [inputFocused, setInputFocused] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusedCardRef = useRef<HTMLDivElement>(null);

  // Debounce the search query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isLoading } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: () => searchMedia(debouncedQuery),
    enabled: debouncedQuery.length >= 2,
  });

  const results = (data?.data ?? []).map(normalizeMedia);

  // Focus input on mount to trigger webOS virtual keyboard
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-scroll focused result into view
  useEffect(() => {
    if (!inputFocused) {
      focusedCardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focusedIdx, inputFocused]);

  useRemoteKeys((e) => {
    if (navFocused) return;

    if (e.keyCode === KEY.BACK) {
      navigate({ name: 'home' });
      return;
    }

    if (inputFocused) {
      if (e.keyCode === KEY.DOWN && results.length > 0) {
        e.preventDefault();
        setInputFocused(false);
        setFocusedIdx(0);
        inputRef.current?.blur();
      } else if (e.keyCode === KEY.UP) {
        e.preventDefault();
        onFocusNav();
      }
      // Other keys handled natively by the input element
      return;
    }

    // Results grid navigation
    e.preventDefault();
    const COLS = 5;
    if (e.keyCode === KEY.UP) {
      const newIdx = focusedIdx - COLS;
      if (newIdx < 0) {
        setInputFocused(true);
        inputRef.current?.focus();
      } else {
        setFocusedIdx(newIdx);
      }
    } else if (e.keyCode === KEY.DOWN) {
      const newIdx = focusedIdx + COLS;
      if (newIdx < results.length) setFocusedIdx(newIdx);
    } else if (e.keyCode === KEY.LEFT) {
      if (focusedIdx % COLS > 0) setFocusedIdx(focusedIdx - 1);
    } else if (e.keyCode === KEY.RIGHT) {
      if (focusedIdx % COLS < COLS - 1 && focusedIdx + 1 < results.length) setFocusedIdx(focusedIdx + 1);
    } else if (e.keyCode === KEY.OK) {
      const media = results[focusedIdx];
      if (media) navigate({ name: 'detail', mediaId: media.id, mediaType: media.type });
    }
  }, [navFocused, inputFocused, focusedIdx, results, navigate, onFocusNav]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '1.5rem 3rem' }}>
      {/* Search input */}
      <div style={{ marginBottom: '1.5rem', position: 'relative' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.8rem',
          background: 'rgba(255,255,255,0.07)',
          border: `2px solid ${inputFocused ? '#fff' : 'rgba(255,255,255,0.12)'}`,
          borderRadius: '12px',
          padding: '0.7rem 1.2rem',
          transition: 'border-color 0.15s',
        }}>
          <span style={{ fontSize: '1rem', flexShrink: 0, opacity: 0.6 }}>🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setFocusedIdx(0); }}
            onFocus={() => setInputFocused(true)}
            onBlur={() => { /* keep inputFocused state managed by remote */ }}
            placeholder="Titre, acteur, genre…"
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              color: '#fff', fontSize: '0.85rem', fontFamily: 'inherit',
            }}
          />
          {query && (
            <button
              onClick={() => { setQuery(''); setDebouncedQuery(''); inputRef.current?.focus(); }}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '0.7rem', padding: '0.2rem' }}
            >
              ✕
            </button>
          )}
        </div>
        <div style={{ marginTop: '0.4rem', fontSize: '0.5rem', color: 'rgba(255,255,255,0.25)' }}>
          OK pour valider · ↓ pour naviguer les résultats · BACK pour retour
        </div>
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {debouncedQuery.length < 2 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60%', color: 'rgba(255,255,255,0.2)', fontSize: '0.65rem', textAlign: 'center' }}>
            Tapez au moins 2 caractères pour rechercher
          </div>
        )}
        {debouncedQuery.length >= 2 && isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60%', color: 'rgba(255,255,255,0.3)', fontSize: '0.65rem' }}>
            Recherche…
          </div>
        )}
        {debouncedQuery.length >= 2 && !isLoading && results.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60%', color: 'rgba(255,255,255,0.25)', fontSize: '0.65rem', textAlign: 'center' }}>
            Aucun résultat pour « {debouncedQuery} »
          </div>
        )}
        {results.length > 0 && (
          <div>
            <div style={{ fontSize: '0.55rem', color: 'rgba(255,255,255,0.3)', marginBottom: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {data?.total ?? results.length} résultat{(data?.total ?? results.length) !== 1 ? 's' : ''}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.8rem' }}>
              {results.map((media, idx) => {
                const isFocused = !inputFocused && focusedIdx === idx;
                return (
                  <div
                    key={media.id}
                    ref={isFocused ? focusedCardRef : undefined}
                    onClick={() => navigate({ name: 'detail', mediaId: media.id, mediaType: media.type })}
                    style={{
                      borderRadius: '8px',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      border: `2px solid ${isFocused ? '#fff' : 'transparent'}`,
                      transform: isFocused ? 'scale(1.04)' : 'scale(1)',
                      transition: 'all 0.12s ease',
                      background: '#18181b',
                      willChange: 'transform',
                    }}
                  >
                    {/* Poster */}
                    <div style={{ aspectRatio: '2/3', position: 'relative' }}>
                      {media.posterUrl ? (
                        <img
                          src={media.posterUrl}
                          alt={media.title}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                      ) : (
                        <div style={{
                          width: '100%', height: '100%', display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                          background: '#27272a', color: 'rgba(255,255,255,0.3)',
                          fontSize: '0.5rem', padding: '0.5rem', textAlign: 'center',
                        }}>
                          {media.title}
                        </div>
                      )}
                      {/* Type badge */}
                      <div style={{
                        position: 'absolute', top: '0.3rem', left: '0.3rem',
                        fontSize: '0.38rem', fontWeight: 700, padding: '0.15rem 0.4rem',
                        borderRadius: '3px',
                        background: media.type === 'series' ? 'rgba(59,130,246,0.85)' : 'rgba(229,9,20,0.85)',
                        color: '#fff',
                      }}>
                        {media.type === 'series' ? 'Série' : 'Film'}
                      </div>
                    </div>
                    {/* Info */}
                    <div style={{ padding: '0.4rem 0.5rem' }}>
                      <div style={{
                        fontSize: '0.5rem', fontWeight: isFocused ? 700 : 600,
                        color: isFocused ? '#fff' : 'rgba(255,255,255,0.8)',
                        lineHeight: 1.3,
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}>
                        {media.title}
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.2rem', alignItems: 'center' }}>
                        {media.releaseYear && (
                          <span style={{ fontSize: '0.42rem', color: 'rgba(255,255,255,0.35)' }}>{media.releaseYear}</span>
                        )}
                        {media.voteAverage && media.voteAverage > 0 && (
                          <span style={{ fontSize: '0.42rem', color: '#fbbf24' }}>★ {media.voteAverage.toFixed(1)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
