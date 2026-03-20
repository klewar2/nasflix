import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMediaById } from '../lib/api';
import { KEY, useRemoteKeys } from '../hooks/useRemoteKeys';
import type { Screen } from '../App';

interface Props {
  mediaId: number;
  mediaType: 'movie' | 'series';
  navigate: (s: Screen) => void;
}

const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';

type FocusZone = 'play' | 'back' | { episodeIdx: number };

export default function DetailPage({ mediaId, mediaType, navigate }: Props) {
  const [focused, setFocused] = useState<FocusZone>('play');

  const { data: media, isLoading } = useQuery({
    queryKey: ['media', mediaId],
    queryFn: () => getMediaById(mediaId),
  });

  // For series: episodes list
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const episodes: any[] = media?.seasons?.flatMap((s: any) => s.episodes || []) || [];

  useRemoteKeys((e) => {
    if (e.keyCode === KEY.BACK) {
      e.preventDefault();
      navigate({ name: 'home' });
    } else if (e.keyCode === KEY.UP) {
      e.preventDefault();
      if (typeof focused === 'object') {
        const newIdx = focused.episodeIdx - 1;
        if (newIdx < 0) setFocused('play');
        else setFocused({ episodeIdx: newIdx });
      } else if (focused === 'back') {
        setFocused('play');
      }
    } else if (e.keyCode === KEY.DOWN) {
      e.preventDefault();
      if (focused === 'play') {
        if (mediaType === 'series' && episodes.length > 0) {
          setFocused({ episodeIdx: 0 });
        } else {
          setFocused('back');
        }
      } else if (typeof focused === 'object') {
        const newIdx = focused.episodeIdx + 1;
        if (newIdx < episodes.length) setFocused({ episodeIdx: newIdx });
        else setFocused('back');
      }
    } else if (e.keyCode === KEY.OK) {
      e.preventDefault();
      if (focused === 'back') {
        navigate({ name: 'home' });
      } else if (focused === 'play' && mediaType === 'movie') {
        navigate({ name: 'player', mediaId });
      } else if (typeof focused === 'object') {
        const ep = episodes[focused.episodeIdx];
        if (ep) navigate({ name: 'player', mediaId, episodeId: ep.id });
      }
    } else if (e.keyCode === KEY.LEFT) {
      e.preventDefault();
      if (focused === 'back') setFocused('play');
    } else if (e.keyCode === KEY.RIGHT) {
      e.preventDefault();
      if (focused === 'play') setFocused('back');
    }
  }, [focused, mediaType, episodes, mediaId, navigate]);

  if (isLoading || !media) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <span style={{ color: 'var(--text-muted)' }}>Chargement…</span>
      </div>
    );
  }

  const year = media.releaseYear || (media.releaseDate ? new Date(media.releaseDate).getFullYear() : null);

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Poster side */}
      <div
        style={{
          width: '22rem',
          flexShrink: 0,
          background: 'var(--bg-card)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {media.posterPath ? (
          <img
            src={`${TMDB_IMG}${media.posterPath}`}
            alt={media.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>Pas d'affiche</div>
        )}
      </div>

      {/* Info side */}
      <div style={{ flex: 1, padding: '3rem 3rem 2rem', overflowY: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <h1 style={{ fontSize: '1.8rem', fontWeight: 800, marginBottom: '0.5rem' }}>{media.title}</h1>

        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.2rem', flexWrap: 'wrap' }}>
          {year && <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{year}</span>}
          {media.genres?.length > 0 && (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {media.genres.slice(0, 3).join(' · ')}
            </span>
          )}
          {media.voteAverage > 0 && (
            <span style={{ color: '#facc15', fontSize: '0.85rem' }}>★ {media.voteAverage.toFixed(1)}</span>
          )}
        </div>

        {media.overview && (
          <p
            style={{
              color: 'var(--text-muted)',
              fontSize: '0.8rem',
              lineHeight: 1.6,
              marginBottom: '2rem',
              maxWidth: '50rem',
              display: '-webkit-box',
              WebkitLineClamp: 4,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {media.overview}
          </p>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
          {mediaType === 'movie' && (
            <button
              data-focused={focused === 'play'}
              onFocus={() => setFocused('play')}
              onClick={() => navigate({ name: 'player', mediaId })}
              style={btnStyle(focused === 'play', true)}
            >
              ▶ Regarder
            </button>
          )}
          {mediaType === 'series' && (
            <button
              data-focused={focused === 'play'}
              onFocus={() => setFocused('play')}
              onClick={() => episodes[0] && navigate({ name: 'player', mediaId, episodeId: episodes[0].id })}
              style={btnStyle(focused === 'play', true)}
            >
              ▶ Premier épisode
            </button>
          )}
          <button
            data-focused={focused === 'back'}
            onFocus={() => setFocused('back')}
            onClick={() => navigate({ name: 'home' })}
            style={btnStyle(focused === 'back', false)}
          >
            ← Retour
          </button>
        </div>

        {/* Episode list for series */}
        {mediaType === 'series' && episodes.length > 0 && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <h2 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--text-muted)' }}>
              ÉPISODES ({episodes.length})
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {episodes.map((ep, idx) => {
                const isFocused = typeof focused === 'object' && focused.episodeIdx === idx;
                return (
                  <div
                    key={ep.id}
                    data-focused={isFocused}
                    onFocus={() => setFocused({ episodeIdx: idx })}
                    onClick={() => navigate({ name: 'player', mediaId, episodeId: ep.id })}
                    style={{
                      padding: '0.6rem 0.85rem',
                      borderRadius: 'var(--radius)',
                      background: isFocused ? '#27272a' : 'transparent',
                      border: `2px solid ${isFocused ? 'var(--red)' : 'transparent'}`,
                      cursor: 'pointer',
                      transform: isFocused ? 'scale(1.01)' : 'scale(1)',
                      transition: 'all 0.12s ease',
                    }}
                  >
                    <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>
                      S{ep.seasonNumber?.toString().padStart(2, '0')}E{ep.episodeNumber?.toString().padStart(2, '0')}
                      {ep.title ? ` — ${ep.title}` : ''}
                    </span>
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

function btnStyle(active: boolean, primary: boolean): React.CSSProperties {
  return {
    padding: '0.65rem 1.5rem',
    background: active ? (primary ? 'var(--red)' : '#3f3f46') : primary ? '#7f1d1d' : '#27272a',
    border: `2px solid ${active ? (primary ? 'var(--red)' : '#52525b') : 'transparent'}`,
    borderRadius: 'var(--radius)',
    color: 'var(--text)',
    fontSize: '0.85rem',
    fontWeight: 700,
    cursor: 'pointer',
    transform: active ? 'scale(1.04)' : 'scale(1)',
    transition: 'all 0.15s ease',
  };
}
