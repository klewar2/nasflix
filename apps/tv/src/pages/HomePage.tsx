import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import MediaRow from '../components/MediaRow';
import { KEY, useRemoteKeys } from '../hooks/useRemoteKeys';
import { getRecentMedia, getMedia, getGenres, getQualityMedia, getMediaById } from '../lib/api';
import { watchProgress } from '../lib/progress';
import type { Screen } from '../App';

interface Props {
  navigate: (s: Screen) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  me: any;
  active: boolean;
  navFocused: boolean;
  onFocusNav: () => void;
}

interface NormalizedMedia {
  id: number;
  title: string;
  posterUrl?: string;
  backdropUrl?: string;
  releaseYear?: number;
  type: 'movie' | 'series';
  voteAverage?: number;
  overview?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeMedia(m: any): NormalizedMedia {
  return {
    id: m.id,
    title: m.titleVf || m.title || m.titleOriginal || 'Inconnu',
    posterUrl: m.posterUrl || (m.posterPath ? `https://image.tmdb.org/t/p/w300${m.posterPath}` : undefined),
    backdropUrl: m.backdropUrl || (m.backdropPath ? `https://image.tmdb.org/t/p/w1280${m.backdropPath}` : undefined),
    releaseYear: m.releaseYear || (m.releaseDate ? new Date(m.releaseDate).getFullYear() : undefined),
    type: (m.type === 'SERIES' || m.type === 'series' ? 'series' : 'movie') as 'movie' | 'series',
    voteAverage: m.voteAverage,
    overview: m.overview,
  };
}

/** Inline ContinueCard for the "Reprendre" row */
function ContinueCard({
  item,
  isFocused,
  onClick,
}: {
  item: {
    title: string;
    posterUrl?: string;
    backdropUrl?: string;
    pct: number;
    type: 'movie' | 'series';
  };
  isFocused: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        width: '8rem', flexShrink: 0, borderRadius: '6px', overflow: 'hidden',
        cursor: 'pointer', position: 'relative',
        outline: isFocused ? '2px solid var(--accent)' : '2px solid transparent',
        outlineOffset: '5px',
        boxShadow: isFocused
          ? '0 0 0 7px rgba(177,58,48,0.12), 0 12px 40px rgba(0,0,0,0.7)'
          : '0 2px 10px rgba(0,0,0,0.5)',
        transition: 'outline-color 0.15s, box-shadow 0.15s',
        zIndex: isFocused ? 10 : 1,
        background: 'var(--bg-card)',
      }}
    >
      {/* 16:9 backdrop */}
      <div style={{ aspectRatio: '16/9', position: 'relative', overflow: 'hidden' }}>
        {item.backdropUrl ? (
          <img src={item.backdropUrl} alt={item.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} loading="lazy" />
        ) : item.posterUrl ? (
          <img src={item.posterUrl} alt={item.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', display: 'block' }} loading="lazy" />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            background: 'linear-gradient(135deg, #27272a, #18181b)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgba(255,255,255,0.3)', fontSize: '0.44rem', padding: '0.5rem', textAlign: 'center',
          }}>{item.title}</div>
        )}

        {/* Dark gradient overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to top, rgba(7,7,10,0.9) 0%, rgba(7,7,10,0.3) 50%, transparent 100%)',
        }} />

        {/* Play circle button top-right */}
        <div style={{
          position: 'absolute', top: '0.4rem', right: '0.4rem',
          width: '1.6rem', height: '1.6rem', borderRadius: '50%',
          background: 'rgba(255,255,255,0.15)',
          border: '1px solid rgba(255,255,255,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="white">
            <path d="M3 2 L10 6 L3 10 Z" />
          </svg>
        </div>

        {/* Bottom info */}
        <div style={{
          position: 'absolute', bottom: '0.5rem', left: '0.5rem', right: '0.5rem',
        }}>
          <div style={{
            fontFamily: 'var(--serif)',
            fontSize: '0.44rem', fontWeight: 400, color: '#fff',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            marginBottom: '0.2rem',
          }}>{item.title}</div>
          <div style={{
            fontFamily: 'var(--mono)',
            fontSize: '0.31rem', color: 'rgba(255,255,255,0.5)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            {item.type === 'series' ? 'Série · Reprendre' : 'Film · Reprendre'}
          </div>
        </div>
      </div>

      {/* Progress bar at very bottom */}
      <div style={{ height: '3px', background: 'rgba(255,255,255,0.12)' }}>
        <div style={{ height: '100%', width: `${item.pct}%`, background: 'var(--accent)' }} />
      </div>
    </div>
  );
}

export default function HomePage({ navigate, active, navFocused, onFocusNav }: Props) {
  const [focusedZone, setFocusedZone] = useState(0);
  const [resumeFocusedIdx, setResumeFocusedIdx] = useState(0);
  const [inProgressEntries, setInProgressEntries] = useState(() => watchProgress.listInProgress().slice(0, 12));
  const [previewMedia, setPreviewMedia] = useState<NormalizedMedia | null>(null);

  const [currentBackdrop, setCurrentBackdrop] = useState<string | null>(null);
  const [backdropKey, setBackdropKey] = useState(0);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const resumeSectionRef = useRef<HTMLDivElement>(null);
  const rowSectionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const mountedRef = useRef(false);

  const { data: recent = [] } = useQuery({
    queryKey: ['recent'],
    queryFn: () => getRecentMedia(20),
  });

  const { data: moviesResult } = useQuery({
    queryKey: ['media', 'movie'],
    queryFn: () => getMedia({ type: 'movie', limit: 30 }),
  });

  const { data: seriesResult } = useQuery({
    queryKey: ['media', 'series'],
    queryFn: () => getMedia({ type: 'series', limit: 30 }),
  });

  const { data: uhdMedia = [] } = useQuery({
    queryKey: ['quality', 'UHD'],
    queryFn: () => getQualityMedia('UHD', 20),
  });

  const { data: genres = [] } = useQuery({
    queryKey: ['genres'],
    queryFn: getGenres,
  });

  // Refresh in-progress entries when page becomes active
  useEffect(() => {
    if (active) setInProgressEntries(watchProgress.listInProgress().slice(0, 12));
  }, [active]);

  const resumeQueries = useQueries({
    queries: inProgressEntries.map((entry) => ({
      queryKey: ['media', entry.mediaId],
      queryFn: () => getMediaById(entry.mediaId),
      staleTime: 5 * 60 * 1000,
    })),
  });

  const resumeItems = inProgressEntries
    .map((entry, i) => {
      const data = resumeQueries[i]?.data;
      if (!data) return null;
      return {
        mediaId: entry.mediaId,
        episodeId: entry.episodeId,
        pct: watchProgress.pct(entry.mediaId, entry.episodeId),
        title: (data.titleVf || data.title || data.titleOriginal || 'Inconnu') as string,
        posterUrl: (data.posterUrl || (data.posterPath ? `https://image.tmdb.org/t/p/w300${data.posterPath}` : undefined)) as string | undefined,
        backdropUrl: (data.backdropUrl || (data.backdropPath ? `https://image.tmdb.org/t/p/w1280${data.backdropPath}` : undefined)) as string | undefined,
        type: (data.type === 'SERIES' || data.type === 'series' ? 'series' : 'movie') as 'movie' | 'series',
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const hasResume = resumeItems.length > 0;

  const topGenres = genres.slice(0, 4);
  const genreMediaResults = useQueries({
    queries: topGenres.map((genre) => ({
      queryKey: ['media', 'genre', genre.id],
      queryFn: () => getMedia({ genreId: genre.id, limit: 20 }),
    })),
  });

  const staticRows = [
    { title: 'Récemment ajoutés', subtitle: 'Dernières sorties', items: recent.map(normalizeMedia) },
    { title: '4K Ultra HD', subtitle: 'Qualité maximale', items: uhdMedia.map(normalizeMedia) },
    { title: 'Films', subtitle: 'Catalogue complet', items: (moviesResult?.data || []).map(normalizeMedia) },
    { title: 'Séries', subtitle: 'Toutes les saisons', items: (seriesResult?.data || []).map(normalizeMedia) },
  ].filter((r) => r.items.length > 0);

  const genreRows = topGenres
    .map((genre, idx) => ({
      title: genre.name,
      subtitle: 'Genre',
      items: (genreMediaResults[idx]?.data?.data || []).map(normalizeMedia),
    }))
    .filter((r) => r.items.length > 0);

  const allRows = [...staticRows, ...genreRows];

  // Update backdrop with smooth crossfade
  const updateBackdrop = (media: NormalizedMedia) => {
    if (media.backdropUrl && media.backdropUrl !== currentBackdrop) {
      clearTimeout(previewTimer.current);
      previewTimer.current = setTimeout(() => {
        setCurrentBackdrop(media.backdropUrl!);
        setBackdropKey((k) => k + 1);
      }, 200);
    }
    setPreviewMedia(media);
  };

  // Init preview with first item
  useEffect(() => {
    if (allRows.length > 0 && allRows[0].items.length > 0 && !previewMedia) {
      const first = allRows[0].items[0];
      setPreviewMedia(first);
      if (first.backdropUrl) setCurrentBackdrop(first.backdropUrl);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows.length]);

  const totalZones = (hasResume ? 1 : 0) + allRows.length;

  // Auto-scroll to the focused zone whenever it changes
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    if (!active) return;
    if (navFocused) {
      scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    let el: HTMLDivElement | null = null;
    if (hasResume && focusedZone === 0) {
      el = resumeSectionRef.current;
    } else {
      const rowIdx = hasResume ? focusedZone - 1 : focusedZone;
      el = rowSectionRefs.current[rowIdx] ?? null;
    }
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusedZone, navFocused, active, hasResume]);

  useRemoteKeys((e) => {
    if (!active || navFocused) return;
    if (e.keyCode === KEY.UP) {
      e.preventDefault();
      if (focusedZone === 0) onFocusNav();
      else setFocusedZone((z) => z - 1);
    } else if (e.keyCode === KEY.DOWN) {
      e.preventDefault();
      if (focusedZone < totalZones - 1) setFocusedZone((z) => z + 1);
    } else if (hasResume && focusedZone === 0 && e.keyCode === KEY.LEFT) {
      e.preventDefault();
      setResumeFocusedIdx((i) => Math.max(0, i - 1));
    } else if (hasResume && focusedZone === 0 && e.keyCode === KEY.RIGHT) {
      e.preventDefault();
      setResumeFocusedIdx((i) => Math.min(resumeItems.length - 1, i + 1));
    } else if (hasResume && focusedZone === 0 && e.keyCode === KEY.OK) {
      e.preventDefault();
      const item = resumeItems[resumeFocusedIdx];
      if (item) navigate({ name: 'player', mediaId: item.mediaId, episodeId: item.episodeId, title: item.title });
    }
  }, [active, navFocused, focusedZone, totalZones, hasResume, resumeItems, resumeFocusedIdx, onFocusNav, navigate]);

  return (
    <div ref={scrollContainerRef} style={{ height: '100%', overflowY: 'auto' }}>
      {/* ── Hero panel ── */}
      <div style={{ height: '640px', position: 'relative', overflow: 'hidden' }}>
        {/* Backdrop */}
        {currentBackdrop ? (
          <div
            key={backdropKey}
            style={{
              position: 'absolute', inset: 0,
              backgroundImage: `url(${currentBackdrop})`,
              backgroundSize: 'cover', backgroundPosition: 'center',
              opacity: 1,
              transition: 'opacity 0.5s ease',
              willChange: 'opacity',
            }}
          />
        ) : (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'radial-gradient(ellipse 80% 60% at 30% 40%, #1a1a2e 0%, var(--bg-deep) 70%)',
          }} />
        )}

        {/* Gradient overlays */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(180deg, rgba(7,7,10,0.6) 0%, transparent 30%, rgba(7,7,10,0.4) 65%, var(--bg-base) 100%)',
        }} />
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(90deg, rgba(7,7,10,0.92) 0%, rgba(7,7,10,0.6) 35%, transparent 70%)',
        }} />

        {/* Hero info panel */}
        {previewMedia && (
          <div style={{
            position: 'absolute', bottom: '1.75rem', left: '2rem',
            maxWidth: '680px',
          }}>
            {/* Eyebrow */}
            <div className="uppercase-eyebrow" style={{ marginBottom: '0.5rem' }}>
              Récemment ajoutée
            </div>

            {/* Title */}
            <h1 style={{
              fontFamily: 'var(--serif)',
              fontSize: '1.75rem', fontWeight: 500,
              lineHeight: 0.95, letterSpacing: '-0.02em',
              color: '#fff', marginBottom: '0.5rem',
              textShadow: '0 2px 24px rgba(0,0,0,0.8)',
            }}>
              {previewMedia.title}
            </h1>

            {/* Meta chips */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
              {previewMedia.voteAverage && previewMedia.voteAverage > 0 && (
                <span className="chip gold">★ {previewMedia.voteAverage.toFixed(1)}</span>
              )}
              {previewMedia.releaseYear && (
                <span className="chip">{previewMedia.releaseYear}</span>
              )}
              <span className="chip">
                {previewMedia.type === 'series' ? 'Série' : 'Film'}
              </span>
              <span className="quality uhd">4K</span>
              <span className="quality hdr">HDR</span>
            </div>

            {/* Overview */}
            {previewMedia.overview && (
              <p style={{
                fontSize: '0.47rem', color: `rgba(236,233,226,0.85)`,
                lineHeight: 1.5, maxWidth: '560px',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                textShadow: '0 1px 8px rgba(0,0,0,0.8)',
                marginBottom: '0.75rem',
              }}>
                {previewMedia.overview}
              </p>
            )}

            {/* CTA buttons */}
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
              <button
                onClick={() => navigate({ name: 'detail', mediaId: previewMedia.id, mediaType: previewMedia.type })}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.31rem',
                  background: '#fff', color: '#0a0a0e',
                  border: 'none', padding: '0.3rem 0.65rem', borderRadius: '4px',
                  fontSize: '0.44rem', fontWeight: 600, cursor: 'pointer',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M2 2 L10 6 L2 10 Z" />
                </svg>
                {previewMedia.type === 'series' ? 'Voir la série' : 'Regarder'}
              </button>
              <button
                onClick={() => navigate({ name: 'detail', mediaId: previewMedia.id, mediaType: previewMedia.type })}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.31rem',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid var(--line-strong)',
                  padding: '0.3rem 0.65rem', borderRadius: '4px',
                  color: '#fff',
                  fontSize: '0.44rem', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Plus d'infos
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Rows ── */}
      <div style={{ paddingTop: '0.5rem' }}>
        {/* Resume row */}
        {hasResume && (
          <div ref={resumeSectionRef} style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', paddingLeft: '2rem', marginBottom: '0.5rem' }}>
              <h2 style={{
                fontFamily: 'var(--serif)',
                fontSize: '0.8125rem', fontWeight: 400,
                color: !navFocused && focusedZone === 0 ? '#fff' : 'rgba(255,255,255,0.5)',
                transition: 'color 0.2s',
              }}>
                Reprendre
              </h2>
              <span style={{
                fontFamily: 'var(--mono)',
                fontSize: '0.34rem', color: 'var(--text-dim)',
                textTransform: 'uppercase', letterSpacing: '0.1em',
              }}>
                EN COURS
              </span>
            </div>
            <div style={{
              display: 'flex', gap: '0.5rem',
              paddingLeft: '2rem', paddingRight: '2rem',
              paddingTop: '0.5rem', paddingBottom: '0.5rem',
              overflowX: 'auto',
            }}>
              {resumeItems.map((item, i) => {
                const isFocused = active && !navFocused && focusedZone === 0 && resumeFocusedIdx === i;
                return (
                  <ContinueCard
                    key={`${item.mediaId}-${item.episodeId ?? 'm'}`}
                    item={item}
                    isFocused={isFocused}
                    onClick={() => navigate({ name: 'player', mediaId: item.mediaId, episodeId: item.episodeId, title: item.title })}
                  />
                );
              })}
            </div>
          </div>
        )}

        {allRows.map((row, idx) => {
          const zone = hasResume ? idx + 1 : idx;
          return (
            <div key={row.title} ref={(el) => { rowSectionRefs.current[idx] = el; }}>
              <MediaRow
                title={row.title}
                items={row.items}
                rowFocused={active && !navFocused && focusedZone === zone}
                onSelect={(media) => navigate({ name: 'detail', mediaId: media.id, mediaType: media.type })}
                onPreview={updateBackdrop}
                onUp={() => { setFocusedZone(zone - 1); }}
                onDown={() => { if (zone + 1 < totalZones) setFocusedZone(zone + 1); }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
