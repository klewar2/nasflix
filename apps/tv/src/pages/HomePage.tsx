import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import MediaRow from '../components/MediaRow';
import { KEY, useRemoteKeys } from '../hooks/useRemoteKeys';
import { getRecentMedia, getMedia, getGenres, getQualityMedia } from '../lib/api';
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

export default function HomePage({ navigate, active, navFocused, onFocusNav }: Props) {
  const [focusedZone, setFocusedZone] = useState(0);
  const [previewMedia, setPreviewMedia] = useState<NormalizedMedia | null>(null);

  const [currentBackdrop, setCurrentBackdrop] = useState<string | null>(null);
  const [backdropKey, setBackdropKey] = useState(0);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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

  const topGenres = genres.slice(0, 4);
  const genreMediaResults = useQueries({
    queries: topGenres.map((genre) => ({
      queryKey: ['media', 'genre', genre.id],
      queryFn: () => getMedia({ genreId: genre.id, limit: 20 }),
    })),
  });

  const staticRows = [
    { title: 'Récemment ajoutés', items: recent.map(normalizeMedia) },
    { title: '4K Ultra HD', items: uhdMedia.map(normalizeMedia) },
    { title: 'Films', items: (moviesResult?.data || []).map(normalizeMedia) },
    { title: 'Séries', items: (seriesResult?.data || []).map(normalizeMedia) },
  ].filter((r) => r.items.length > 0);

  const genreRows = topGenres
    .map((genre, idx) => ({
      title: genre.name,
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

  useRemoteKeys((e) => {
    if (!active || navFocused) return;
    if (e.keyCode === KEY.UP) {
      e.preventDefault();
      if (focusedZone === 0) {
        onFocusNav();
      } else {
        setFocusedZone((z) => z - 1);
      }
    } else if (e.keyCode === KEY.DOWN) {
      e.preventDefault();
      if (focusedZone < allRows.length - 1) setFocusedZone((z) => z + 1);
    } else if (e.keyCode === KEY.BACK) {
      // On home: BACK does nothing (global handler already prevented system exit)
    }
  }, [active, navFocused, focusedZone, allRows.length, onFocusNav]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Preview / Hero panel */}
      <div style={{ height: '38%', flexShrink: 0, position: 'relative', overflow: 'hidden' }}>
        {/* Backdrop: CSS transition opacity for crossfade (lighter than keyframe animations) */}
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
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #1a1a2e, #16213e, #0f0e17)' }} />
        )}

        {/* Gradient overlays */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(9,9,11,0.3) 0%, rgba(9,9,11,0.85) 100%)' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to right, rgba(9,9,11,0.8) 0%, transparent 60%)' }} />

        {/* Info panel */}
        {previewMedia && (
          <div style={{
            position: 'absolute', bottom: '1.2rem', left: '2.5rem',
            maxWidth: '45%',
          }}>
            <h1 style={{
              fontSize: '1.4rem', fontWeight: 800, lineHeight: 1.2,
              marginBottom: '0.4rem',
              textShadow: '0 2px 16px rgba(0,0,0,0.8)',
            }}>
              {previewMedia.title}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
              {previewMedia.releaseYear && (
                <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.12)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                  {previewMedia.releaseYear}
                </span>
              )}
              {previewMedia.voteAverage && previewMedia.voteAverage > 0 && (
                <span style={{ fontSize: '0.65rem', color: '#fbbf24', fontWeight: 700 }}>
                  ★ {previewMedia.voteAverage.toFixed(1)}
                </span>
              )}
              <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {previewMedia.type === 'series' ? 'Série' : 'Film'}
              </span>
            </div>
            {previewMedia.overview && (
              <p style={{
                fontSize: '0.65rem', color: 'rgba(255,255,255,0.55)', lineHeight: 1.5,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                textShadow: '0 1px 8px rgba(0,0,0,0.8)',
              }}>
                {previewMedia.overview}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Rows */}
      <div style={{ flex: 1, paddingTop: '0.8rem', overflowY: 'hidden' }}>
        {allRows.map((row, idx) => (
          <MediaRow
            key={row.title}
            title={row.title}
            items={row.items}
            rowFocused={active && !navFocused && focusedZone === idx}
            onSelect={(media) => navigate({ name: 'detail', mediaId: media.id, mediaType: media.type })}
            onPreview={updateBackdrop}
            onUp={() => {
              if (idx === 0) onFocusNav();
              else setFocusedZone(idx - 1);
            }}
            onDown={() => {
              if (idx + 1 < allRows.length) setFocusedZone(idx + 1);
            }}
          />
        ))}
      </div>

    </div>
  );
}
