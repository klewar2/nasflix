import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMediaById } from '../lib/api';
import { KEY, useRemoteKeys } from '../hooks/useRemoteKeys';
import { watchProgress } from '../lib/progress';
import type { Screen } from '../App';

interface Props {
  mediaId: number;
  mediaType: 'movie' | 'series';
  navigate: (s: Screen) => void;
  navFocused: boolean;
  onFocusNav: () => void;
}

type FocusZone = 'play' | 'back' | { episodeIdx: number };

export default function DetailPage({ mediaId, mediaType, navigate, navFocused, onFocusNav }: Props) {
  const [focused, setFocused] = useState<FocusZone>('play');
  const episodeListRef = useRef<HTMLDivElement>(null);
  const focusedEpisodeRef = useRef<HTMLDivElement>(null);

  const { data: media, isLoading } = useQuery({
    queryKey: ['media', mediaId],
    queryFn: () => getMediaById(mediaId),
  });

  // Sort seasons descending (latest first), attach seasonNumber from parent season
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seasonGroups: Array<{ seasonNumber: number; episodes: any[] }> = [...(media?.seasons || [])]
    .sort((a: any, b: any) => b.seasonNumber - a.seasonNumber)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((s: any) => ({
      seasonNumber: s.seasonNumber,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      episodes: (s.episodes || []).map((ep: any) => ({ ...ep, seasonNumber: s.seasonNumber })),
    }))
    .filter((g) => g.episodes.length > 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const episodes: any[] = seasonGroups.flatMap((g) => g.episodes);

  const title = media ? (media.titleVf || media.title || media.titleOriginal || '') : '';
  const backdropUrl = media?.backdropUrl || (media?.backdropPath ? `https://image.tmdb.org/t/p/w1280${media.backdropPath}` : null);
  const posterUrl = media?.posterUrl || (media?.posterPath ? `https://image.tmdb.org/t/p/w500${media.posterPath}` : null);
  const year = media?.releaseYear || (media?.releaseDate ? new Date(media.releaseDate).getFullYear() : null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const genreNames = (media?.genres || []).slice(0, 3).map((g: any) => g?.genre?.name || g?.name).filter(Boolean).join(' · ');

  const movieProgressPct = mediaType === 'movie' ? watchProgress.pct(mediaId) : 0;

  const badges: { label: string; color: string; bg: string }[] = [];
  if (media?.videoQuality === '4K') badges.push({ label: '4K UHD', color: '#fff', bg: 'rgba(59,130,246,0.75)' });
  else if (media?.videoQuality === '1080p') badges.push({ label: 'Full HD', color: '#fff', bg: 'rgba(255,255,255,0.15)' });
  if (media?.dolbyVision) badges.push({ label: 'Dolby Vision', color: '#fff', bg: 'rgba(106,13,173,0.8)' });
  else if (media?.hdr) badges.push({ label: 'HDR', color: '#000', bg: 'rgba(250,204,21,0.9)' });
  if (media?.dolbyAtmos) badges.push({ label: 'Dolby Atmos', color: '#fff', bg: 'rgba(0,90,170,0.85)' });

  useRemoteKeys((e) => {
    if (navFocused) return;
    if (e.keyCode === KEY.BACK) {
      navigate({ name: 'home' });
    } else if (e.keyCode === KEY.UP) {
      e.preventDefault();
      if (typeof focused === 'object') {
        const newIdx = focused.episodeIdx - 1;
        if (newIdx < 0) setFocused('play');
        else setFocused({ episodeIdx: newIdx });
      } else if (focused === 'back') {
        setFocused('play');
      } else if (focused === 'play') {
        onFocusNav();
      }
    } else if (e.keyCode === KEY.DOWN) {
      e.preventDefault();
      if (focused === 'play') {
        if (mediaType === 'series' && episodes.length > 0) setFocused({ episodeIdx: 0 });
        else setFocused('back');
      } else if (typeof focused === 'object') {
        const newIdx = focused.episodeIdx + 1;
        if (newIdx < episodes.length) setFocused({ episodeIdx: newIdx });
        else setFocused('back');
      }
    } else if (e.keyCode === KEY.OK) {
      e.preventDefault();
      if (focused === 'back') navigate({ name: 'home' });
      else if (focused === 'play' && mediaType === 'movie') navigate({ name: 'player', mediaId, title });
      else if (focused === 'play' && mediaType === 'series' && episodes.length > 0) setFocused({ episodeIdx: 0 });
      else if (typeof focused === 'object') {
        const ep = episodes[focused.episodeIdx];
        if (ep) navigate({ name: 'player', mediaId, episodeId: ep.id, title: `${title} · S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}` });
      }
    } else if (e.keyCode === KEY.LEFT) {
      e.preventDefault();
      if (focused === 'back') setFocused('play');
    } else if (e.keyCode === KEY.RIGHT) {
      e.preventDefault();
      if (focused === 'play') setFocused('back');
    }
  }, [focused, mediaType, episodes, mediaId, navigate, navFocused, onFocusNav, title]);

  // Auto-scroll focused episode into view
  useEffect(() => {
    if (typeof focused === 'object' && focusedEpisodeRef.current && episodeListRef.current) {
      focusedEpisodeRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focused]);

  if (isLoading || !media) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Chargement…</div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
      {/* Full-bleed backdrop */}
      {backdropUrl ? (
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `url(${backdropUrl})`,
          backgroundSize: 'cover', backgroundPosition: 'center top',
        }} />
      ) : (
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #1a1a2e, #16213e)' }} />
      )}
      {/* Gradient overlays */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(9,9,11,0.5) 0%, rgba(9,9,11,0.92) 60%, rgba(9,9,11,0.98) 100%)' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to right, rgba(9,9,11,0.0) 40%, rgba(9,9,11,0.95) 100%)' }} />

      {/* Content */}
      <div style={{ position: 'relative', height: '100%', display: 'flex', gap: '2rem', padding: '1.5rem 3rem', overflow: 'hidden' }}>
        {/* Left: poster */}
        <div style={{ flexShrink: 0, width: '13rem', alignSelf: 'flex-start', position: 'relative' }}>
          {posterUrl ? (
            <img src={posterUrl} alt={title} style={{
              width: '100%', borderRadius: '10px',
              boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
              display: 'block',
            }} />
          ) : (
            <div style={{
              width: '100%', aspectRatio: '2/3', borderRadius: '10px',
              background: '#27272a',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(255,255,255,0.4)', fontSize: '0.6rem', padding: '1rem', textAlign: 'center',
            }}>
              {title}
            </div>
          )}
          {/* Badges on poster */}
          {badges.length > 0 && (
            <div style={{ position: 'absolute', bottom: '-0.5rem', left: '0.5rem', right: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
              {badges.map((b) => (
                <span key={b.label} style={{
                  fontSize: '0.38rem', fontWeight: 800, padding: '0.2rem 0.45rem', borderRadius: '3px',
                  background: b.bg, color: b.color, letterSpacing: '0.05em', textTransform: 'uppercase',
                                  }}>{b.label}</span>
              ))}
            </div>
          )}
        </div>

        {/* Right: info */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {/* Title */}
          <h1 style={{ fontSize: '1.6rem', fontWeight: 900, lineHeight: 1.1, marginBottom: '0.5rem', textShadow: '0 2px 16px rgba(0,0,0,0.5)' }}>
            {title}
          </h1>

          {/* Meta row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            {year && <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.55)', fontWeight: 600 }}>{year}</span>}
            {genreNames && <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.45)' }}>{genreNames}</span>}
            {media.voteAverage > 0 && (
              <span style={{ fontSize: '0.65rem', color: '#fbbf24', fontWeight: 700 }}>★ {media.voteAverage.toFixed(1)}</span>
            )}
            {media.runtime > 0 && (
              <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.45)' }}>{media.runtime} min</span>
            )}
          </div>

          {/* Overview */}
          {media.overview && (
            <p style={{
              fontSize: '0.65rem', color: 'rgba(255,255,255,0.6)', lineHeight: 1.6,
              marginBottom: '1.2rem', maxWidth: '42rem',
              display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {media.overview}
            </p>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '0.8rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <button
              data-focused={focused === 'play'}
              onFocus={() => setFocused('play')}
              onClick={() => {
                if (mediaType === 'movie') navigate({ name: 'player', mediaId, title });
                else if (episodes.length > 0) setFocused({ episodeIdx: 0 });
              }}
              style={btnStyle(focused === 'play', true)}
            >
              ▶ {mediaType === 'series' ? 'Choisir un épisode' : (movieProgressPct > 1 ? 'Reprendre' : 'Regarder')}
            </button>
            <button
              data-focused={focused === 'back'}
              onFocus={() => setFocused('back')}
              onClick={() => navigate({ name: 'home' })}
              style={btnStyle(focused === 'back', false)}
            >
              ← Retour
            </button>
          </div>

          {/* Movie progress bar */}
          {mediaType === 'movie' && movieProgressPct > 1 && (
            <div style={{ marginBottom: '1rem', maxWidth: '20rem' }}>
              <div style={{ height: '3px', background: 'rgba(255,255,255,0.15)', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${movieProgressPct}%`, background: 'var(--red)', borderRadius: '2px' }} />
              </div>
              <span style={{ fontSize: '0.55rem', color: 'rgba(255,255,255,0.35)', marginTop: '0.2rem', display: 'block' }}>
                {Math.round(movieProgressPct)}% regardé
              </span>
            </div>
          )}

          {/* Episodes list — grouped by season, latest first */}
          {mediaType === 'series' && episodes.length > 0 && (
            <div ref={episodeListRef} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              <h2 style={{
                fontSize: '0.55rem', fontWeight: 700, marginBottom: '0.6rem',
                color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em',
              }}>
                Épisodes ({episodes.length})
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                {seasonGroups.map((group) => (
                  <div key={group.seasonNumber}>
                    {/* Season header */}
                    <div style={{
                      fontSize: '0.5rem', fontWeight: 700, color: 'rgba(255,255,255,0.3)',
                      textTransform: 'uppercase', letterSpacing: '0.1em',
                      marginBottom: '0.3rem', paddingLeft: '0.2rem',
                    }}>
                      Saison {group.seasonNumber}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                      {group.episodes.map((ep) => {
                        const idx = episodes.indexOf(ep);
                        const isFocused = typeof focused === 'object' && focused.episodeIdx === idx;
                        const epPct = watchProgress.pct(mediaId, ep.id);
                        return (
                          <div
                            key={ep.id}
                            ref={isFocused ? focusedEpisodeRef : undefined}
                            data-focused={isFocused}
                            onFocus={() => setFocused({ episodeIdx: idx })}
                            onClick={() => navigate({ name: 'player', mediaId, episodeId: ep.id, title: `${title} · S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}` })}
                            style={{
                              padding: '0.5rem 0.7rem',
                              borderRadius: '8px',
                              background: isFocused ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
                              border: `1px solid ${isFocused ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.06)'}`,
                              cursor: 'pointer',
                              transition: 'all 0.12s ease',
                              position: 'relative',
                              overflow: 'hidden',
                            }}
                          >
                            {epPct > 1 && (
                              <div style={{
                                position: 'absolute', bottom: 0, left: 0,
                                height: '2px', width: `${epPct}%`,
                                background: 'var(--red)',
                              }} />
                            )}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: '0.6rem', fontWeight: isFocused ? 700 : 500, color: isFocused ? '#fff' : 'rgba(255,255,255,0.55)' }}>
                                E{String(ep.episodeNumber).padStart(2, '0')}
                                {ep.name || ep.title ? ` — ${ep.name || ep.title}` : ''}
                              </span>
                              {epPct > 1 && (
                                <span style={{ fontSize: '0.55rem', color: 'rgba(229,9,20,0.8)', fontWeight: 600, flexShrink: 0, marginLeft: '0.5rem' }}>
                                  {Math.round(epPct)}%
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function btnStyle(active: boolean, primary: boolean): React.CSSProperties {
  return {
    padding: '0.6rem 1.6rem',
    background: active
      ? (primary ? 'var(--red)' : 'rgba(255,255,255,0.15)')
      : (primary ? 'rgba(229,9,20,0.25)' : 'rgba(255,255,255,0.07)'),
    border: 'none',
    outline: active ? '4px solid #fff' : '4px solid transparent',
    outlineOffset: '3px',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '0.65rem',
    fontWeight: 700,
    cursor: 'pointer',
    transform: active ? 'scale(1.08)' : 'scale(1)',
    transition: active
      ? 'transform 175ms ease-out, outline 175ms ease-out, box-shadow 175ms ease-out'
      : 'transform 100ms ease-in, outline 100ms ease-in',
    boxShadow: active ? '0 4px 24px rgba(0,0,0,0.5)' : 'none',
  };
}
