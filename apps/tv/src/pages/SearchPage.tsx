import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KEY, useRemoteKeys } from '../hooks/useRemoteKeys';
import { searchMedia } from '../lib/api';
import type { Screen } from '../App';

const COLS = 4;

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
  const [zone, setZone] = useState<'input' | 'grid'>('input');
  const inputRef = useRef<HTMLInputElement>(null);
  const focusedCardRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isLoading } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: () => searchMedia(debouncedQuery),
    enabled: debouncedQuery.length >= 2,
  });

  const results = (data?.data ?? []).map(normalizeMedia);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Reset to input when query cleared
  useEffect(() => {
    if (query === '') { setZone('input'); setFocusedIdx(0); }
  }, [query]);

  // Auto-scroll focused card into view
  useEffect(() => {
    if (zone === 'grid') {
      focusedCardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focusedIdx, zone]);

  useRemoteKeys((e) => {
    if (navFocused) return;

    if (e.keyCode === KEY.BACK) {
      e.preventDefault();
      if (zone === 'grid') { setZone('input'); inputRef.current?.focus(); }
      else navigate({ name: 'home' });
      return;
    }

    if (zone === 'input') {
      if (e.keyCode === KEY.UP) { e.preventDefault(); onFocusNav(); }
      else if (e.keyCode === KEY.DOWN && results.length > 0) {
        e.preventDefault();
        setZone('grid'); setFocusedIdx(0);
        inputRef.current?.blur();
      }
      return;
    }

    // grid
    e.preventDefault();
    const row = Math.floor(focusedIdx / COLS);
    const col = focusedIdx % COLS;

    if (e.keyCode === KEY.UP) {
      if (row === 0) { setZone('input'); inputRef.current?.focus(); }
      else setFocusedIdx(focusedIdx - COLS);
    } else if (e.keyCode === KEY.DOWN) {
      const next = focusedIdx + COLS;
      if (next < results.length) setFocusedIdx(next);
    } else if (e.keyCode === KEY.LEFT) {
      if (col > 0) setFocusedIdx(focusedIdx - 1);
    } else if (e.keyCode === KEY.RIGHT) {
      if (col < COLS - 1 && focusedIdx + 1 < results.length) setFocusedIdx(focusedIdx + 1);
    } else if (e.keyCode === KEY.OK) {
      const media = results[focusedIdx];
      if (media) navigate({ name: 'detail', mediaId: media.id, mediaType: media.type });
    }
  }, [navFocused, zone, focusedIdx, results, navigate, onFocusNav]);

  const showEmpty = debouncedQuery.length >= 2 && !isLoading && results.length === 0;
  const showHint = debouncedQuery.length < 2 && !query;

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>
      {/* ── Left panel: search input + voice search ── */}
      <div style={{
        width: '540px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: '1.5rem 1.5rem 1.5rem 2rem',
        borderRight: '1px solid var(--line)',
        gap: '1.2rem',
      }}>
        {/* Search label */}
        <div className="uppercase-eyebrow">Recherche</div>

        {/* Search input */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.6rem',
          background: zone === 'input' ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${zone === 'input' ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.1)'}`,
          borderRadius: '8px', padding: '0.5rem 0.8rem',
          outline: zone === 'input' ? '3px solid rgba(255,255,255,0.15)' : 'none',
          outlineOffset: '2px',
          transition: 'all 0.2s ease',
        }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: zone === 'input' ? 0.7 : 0.3 }}>
            <circle cx="6.5" cy="6.5" r="5" stroke="white" strokeWidth="1.5" />
            <path d="M10.5 10.5 L14 14" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setFocusedIdx(0); if (e.target.value) setZone('input'); }}
            onFocus={() => setZone('input')}
            placeholder="Titre, acteur, réalisateur…"
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              color: '#fff', fontSize: '0.56rem', fontFamily: 'inherit',
            }}
          />
          {query && (
            <button
              onClick={() => { setQuery(''); setDebouncedQuery(''); setZone('input'); inputRef.current?.focus(); }}
              style={{
                background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%',
                width: '1rem', height: '1rem',
                color: 'rgba(255,255,255,0.6)', cursor: 'pointer',
                fontSize: '0.38rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Voice search block — decorative */}
        <div style={{
          marginTop: '0.5rem',
          padding: '0.8rem 1rem',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid var(--line-strong)',
          borderRadius: '8px',
          display: 'flex', flexDirection: 'column', gap: '0.4rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--text-dim)', flexShrink: 0 }}>
              <rect x="5" y="1" width="6" height="9" rx="3" stroke="currentColor" strokeWidth="1.3" />
              <path d="M2 8c0 3.3 2.7 6 6 6s6-2.7 6-6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <line x1="8" y1="14" x2="8" y2="16" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <span style={{ fontSize: '0.44rem', fontWeight: 500, color: 'var(--text-muted)' }}>Recherche vocale</span>
          </div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.31rem', color: 'var(--text-dim)', letterSpacing: '0.04em' }}>
            Maintenez ◯ sur la télécommande
          </span>
        </div>
      </div>

      {/* ── Right panel: results ── */}
      <div ref={gridRef} style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1.5rem 1.5rem 1.5rem' }}>
        {/* Hint */}
        {showHint && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            height: '70%', gap: '0.8rem',
          }}>
            <svg width="48" height="48" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.1 }}>
              <circle cx="6.5" cy="6.5" r="5" stroke="white" strokeWidth="1.5" />
              <path d="M10.5 10.5 L14 14" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span style={{ fontSize: '0.5rem', color: 'var(--text-dim)', textAlign: 'center' }}>
              Commencez à taper pour rechercher
            </span>
          </div>
        )}

        {/* Loading */}
        {debouncedQuery.length >= 2 && isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '3rem' }}>
            <div style={{
              width: '1.2rem', height: '1.2rem',
              border: '2px solid rgba(255,255,255,0.1)',
              borderTop: '2px solid var(--accent)',
              borderRadius: '50%',
              animation: 'nasflix-spin 0.8s linear infinite',
            }} />
          </div>
        )}

        {/* No results */}
        {showEmpty && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '60%', gap: '0.5rem',
          }}>
            <span style={{ fontSize: '0.5rem', color: 'var(--text-muted)' }}>Aucun résultat pour</span>
            <span style={{ fontFamily: 'var(--serif)', fontSize: '0.9rem', fontWeight: 400, color: '#fff' }}>
              « {debouncedQuery} »
            </span>
          </div>
        )}

        {/* Results grid */}
        {results.length > 0 && (
          <>
            <h2 style={{
              fontFamily: 'var(--serif)',
              fontSize: '0.75rem', fontWeight: 400, color: '#fff',
              marginBottom: '0.7rem',
            }}>
              Résultats pour «&nbsp;{debouncedQuery}&nbsp;»
              <span style={{ fontFamily: 'var(--mono)', fontSize: '0.34rem', color: 'var(--text-dim)', marginLeft: '0.5rem', fontWeight: 400 }}>
                {data?.total ?? results.length}
              </span>
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: '0.625rem' }}>
              {results.map((media, idx) => {
                const isFocused = zone === 'grid' && focusedIdx === idx;
                return (
                  <div
                    key={media.id}
                    ref={isFocused ? focusedCardRef : undefined}
                    data-focused={isFocused}
                    onClick={() => navigate({ name: 'detail', mediaId: media.id, mediaType: media.type })}
                    style={{
                      borderRadius: '6px', overflow: 'hidden', cursor: 'pointer',
                      background: 'var(--bg-card)',
                      outline: isFocused ? '2px solid var(--accent)' : '2px solid transparent',
                      outlineOffset: '3px',
                      boxShadow: isFocused
                        ? '0 0 0 6px rgba(236,233,226,0.12), 0 12px 36px rgba(255,255,255,0.08), 0 4px 16px rgba(0,0,0,0.7)'
                        : '0 2px 8px rgba(0,0,0,0.5)',
                      transform: isFocused ? 'scale(1.06)' : 'scale(1)',
                      transition: 'all 0.12s ease',
                      zIndex: isFocused ? 10 : 1,
                      willChange: 'transform',
                    }}
                  >
                    <div style={{ aspectRatio: '2/3', position: 'relative' }}>
                      {media.posterUrl ? (
                        <img src={media.posterUrl} alt={media.title}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          loading="lazy"
                        />
                      ) : (
                        <div style={{
                          width: '100%', height: '100%',
                          background: 'linear-gradient(135deg, #27272a, #18181b)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: 'var(--text-dim)', fontSize: '0.38rem',
                          padding: '0.4rem', textAlign: 'center',
                        }}>{media.title}</div>
                      )}
                      <span style={{
                        position: 'absolute', top: '0.25rem', right: '0.25rem',
                        fontSize: '0.3rem', fontWeight: 700, padding: '0.1rem 0.3rem',
                        borderRadius: '2px',
                        background: media.type === 'series' ? 'rgba(59,130,246,0.85)' : 'rgba(177,58,48,0.85)',
                        color: '#fff', letterSpacing: '0.04em',
                      }}>
                        {media.type === 'series' ? 'Série' : 'Film'}
                      </span>
                    </div>
                    <div style={{ padding: '0.28rem 0.35rem 0.38rem' }}>
                      <div style={{
                        fontFamily: 'var(--serif)',
                        fontSize: '0.5rem', fontWeight: 400,
                        color: isFocused ? '#fff' : 'var(--text)',
                        lineHeight: 1.2,
                        display: '-webkit-box', WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}>
                        {media.title}
                      </div>
                      <div style={{
                        fontFamily: 'var(--mono)',
                        fontSize: '0.34rem', color: 'var(--text-dim)', marginTop: '0.12rem',
                      }}>
                        {media.releaseYear}
                        {media.voteAverage && media.voteAverage > 0 && ` · ★ ${media.voteAverage.toFixed(1)}`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
