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

type FocusZone = 'play' | 'back' | { zone: 'tab'; idx: number } | { zone: 'episode'; idx: number };

export default function DetailPage({ mediaId, mediaType, navigate, navFocused, onFocusNav }: Props) {
  const [focused, setFocused] = useState<FocusZone>('play');
  const [activeSeasonIdx, setActiveSeasonIdx] = useState(0);
  const episodeListRef = useRef<HTMLDivElement>(null);
  const focusedEpisodeRef = useRef<HTMLDivElement>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const focusedTabRef = useRef<HTMLDivElement>(null);

  const { data: media, isLoading } = useQuery({
    queryKey: ['media', mediaId],
    queryFn: () => getMediaById(mediaId),
  });

  // Sort seasons descending, keep only episodes available on NAS or Jellyfin
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isEpAvailable = (ep: any) => !!ep.nasPath || !!ep.jellyfinItemId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seasonGroups: Array<{ seasonNumber: number; episodes: any[] }> = [...(media?.seasons || [])]
    .sort((a: any, b: any) => b.seasonNumber - a.seasonNumber)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((s: any) => ({
      seasonNumber: s.seasonNumber,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      episodes: (s.episodes || []).filter(isEpAvailable).map((ep: any) => ({ ...ep, seasonNumber: s.seasonNumber })),
    }))
    .filter((g) => g.episodes.length > 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const episodes: any[] = seasonGroups[activeSeasonIdx]?.episodes ?? [];

  const title = media ? (media.titleVf || media.title || media.titleOriginal || '') : '';
  const backdropUrl = media?.backdropUrl || (media?.backdropPath ? `https://image.tmdb.org/t/p/w1280${media.backdropPath}` : null);
  const posterUrl = media?.posterUrl || (media?.posterPath ? `https://image.tmdb.org/t/p/w500${media.posterPath}` : null);
  const year = media?.releaseYear || (media?.releaseDate ? new Date(media.releaseDate).getFullYear() : null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const genreNames = (media?.genres || []).slice(0, 3).map((g: any) => g?.genre?.name || g?.name).filter(Boolean);

  const movieProgressPct = mediaType === 'movie' ? watchProgress.pct(mediaId) : 0;

  const isSeries = mediaType === 'series';
  const hasTabs = isSeries && seasonGroups.length > 0;

  useRemoteKeys((e) => {
    if (navFocused) return;
    if (e.keyCode === KEY.BACK) {
      navigate({ name: 'home' });
    } else if (e.keyCode === KEY.UP) {
      e.preventDefault();
      if (typeof focused === 'object' && focused.zone === 'episode') {
        if (focused.idx === 0) {
          if (hasTabs) setFocused({ zone: 'tab', idx: activeSeasonIdx });
          else setFocused('play');
        } else setFocused({ zone: 'episode', idx: focused.idx - 1 });
      } else if (typeof focused === 'object' && focused.zone === 'tab') {
        setFocused('play');
      } else if (focused === 'back') {
        setFocused('play');
      } else if (focused === 'play') {
        onFocusNav();
      }
    } else if (e.keyCode === KEY.DOWN) {
      e.preventDefault();
      if (focused === 'play') {
        if (hasTabs) setFocused({ zone: 'tab', idx: activeSeasonIdx });
        else setFocused('back');
      } else if (typeof focused === 'object' && focused.zone === 'tab') {
        if (episodes.length > 0) setFocused({ zone: 'episode', idx: 0 });
        else setFocused('back');
      } else if (typeof focused === 'object' && focused.zone === 'episode') {
        if (focused.idx + 1 < episodes.length) setFocused({ zone: 'episode', idx: focused.idx + 1 });
        else setFocused('back');
      }
    } else if (e.keyCode === KEY.OK) {
      e.preventDefault();
      if (focused === 'back') navigate({ name: 'home' });
      else if (focused === 'play' && mediaType === 'movie') navigate({ name: 'player', mediaId, title, videoQuality: media?.videoQuality, hdr: media?.hdr });
      else if (focused === 'play' && hasTabs) setFocused({ zone: 'tab', idx: activeSeasonIdx });
      else if (typeof focused === 'object' && focused.zone === 'tab') {
        if (episodes.length > 0) setFocused({ zone: 'episode', idx: 0 });
      } else if (typeof focused === 'object' && focused.zone === 'episode') {
        const ep = episodes[focused.idx];
        const nextEp = episodes[focused.idx + 1];
        if (ep) navigate({
          name: 'player', mediaId, episodeId: ep.id,
          title: `${title} · S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}`,
          nextEpisodeId: nextEp?.id,
          nextEpisodeTitle: nextEp ? `${title} · S${String(nextEp.seasonNumber).padStart(2, '0')}E${String(nextEp.episodeNumber).padStart(2, '0')}` : undefined,
          videoQuality: media?.videoQuality, hdr: media?.hdr,
        });
      }
    } else if (e.keyCode === KEY.LEFT) {
      e.preventDefault();
      if (focused === 'back') setFocused('play');
      else if (typeof focused === 'object' && focused.zone === 'tab' && focused.idx > 0) {
        const newIdx = focused.idx - 1;
        setActiveSeasonIdx(newIdx);
        setFocused({ zone: 'tab', idx: newIdx });
      } else if (typeof focused === 'object' && focused.zone === 'episode' && focused.idx > 0) {
        setFocused({ zone: 'episode', idx: focused.idx - 1 });
      }
    } else if (e.keyCode === KEY.RIGHT) {
      e.preventDefault();
      if (focused === 'play') setFocused('back');
      else if (typeof focused === 'object' && focused.zone === 'tab' && focused.idx + 1 < seasonGroups.length) {
        const newIdx = focused.idx + 1;
        setActiveSeasonIdx(newIdx);
        setFocused({ zone: 'tab', idx: newIdx });
      } else if (typeof focused === 'object' && focused.zone === 'episode' && focused.idx + 1 < episodes.length) {
        setFocused({ zone: 'episode', idx: focused.idx + 1 });
      }
    }
  }, [focused, mediaType, episodes, mediaId, navigate, navFocused, onFocusNav, title, hasTabs, activeSeasonIdx, seasonGroups.length]);

  // Auto-scroll focused episode / tab into view
  useEffect(() => {
    if (typeof focused === 'object' && focused.zone === 'episode' && focusedEpisodeRef.current && episodeListRef.current) {
      focusedEpisodeRef.current.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
    if (typeof focused === 'object' && focused.zone === 'tab' && focusedTabRef.current && tabBarRef.current) {
      focusedTabRef.current.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
  }, [focused]);

  if (isLoading || !media) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '0.5rem', color: 'var(--text-muted)' }}>Chargement…</div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', position: 'relative' }}>
      {/* Full-bleed backdrop — covers top 720px */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '720px', overflow: 'hidden' }}>
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
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(7,7,10,0.45) 0%, rgba(7,7,10,0.85) 60%, var(--bg-deep) 100%)' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to right, rgba(7,7,10,0.0) 40%, rgba(7,7,10,0.9) 100%)' }} />
      </div>
      {/* Background fill below backdrop */}
      <div style={{ position: 'absolute', top: '720px', left: 0, right: 0, bottom: 0, background: 'var(--bg-deep)' }} />

      {/* Content */}
      <div style={{ position: 'relative', height: '100%', display: 'flex', gap: '1.5rem', padding: '1.25rem 2rem', overflow: 'visible' }}>
        {/* Left: poster */}
        <div style={{ flexShrink: 0, width: '260px', alignSelf: 'flex-start', position: 'relative' }}>
          {posterUrl ? (
            <img src={posterUrl} alt={title} style={{
              width: '100%', borderRadius: '8px',
              boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
              display: 'block',
            }} />
          ) : (
            <div style={{
              width: '100%', aspectRatio: '2/3', borderRadius: '8px',
              background: '#27272a',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(255,255,255,0.4)', fontSize: '0.5rem', padding: '1rem', textAlign: 'center',
            }}>
              {title}
            </div>
          )}
          {/* Quality badges on poster */}
          {(media.videoQuality === '4K' || media.hdr) && (
            <div style={{ position: 'absolute', bottom: '-0.3rem', left: '0.4rem', display: 'flex', gap: '0.25rem' }}>
              {media.videoQuality === '4K' && <span className="quality uhd">4K UHD</span>}
              {media.hdr && <span className="quality hdr">HDR</span>}
            </div>
          )}
        </div>

        {/* Right: info */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'visible' }}>
          {/* Genre eyebrow */}
          {genreNames.length > 0 && (
            <div className="uppercase-eyebrow" style={{ marginBottom: '0.5rem' }}>
              {genreNames.join(' · ')}
            </div>
          )}

          {/* Title */}
          <h1 style={{
            fontFamily: 'var(--serif)',
            fontSize: '2.625rem', fontWeight: 500,
            lineHeight: 0.95, letterSpacing: '-0.02em',
            color: '#fff', marginBottom: '0.75rem',
            textShadow: '0 2px 16px rgba(0,0,0,0.5)',
          }}>
            {title}
          </h1>

          {/* Meta chips */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            {media.voteAverage > 0 && (
              <span className="chip gold">★ {media.voteAverage.toFixed(1)}</span>
            )}
            {year && <span className="chip">{year}</span>}
            {media.runtime > 0 && <span className="chip">{media.runtime} min</span>}
            {isSeries && seasonGroups.length > 0 && (
              <span className="chip">{seasonGroups.length} saison{seasonGroups.length !== 1 ? 's' : ''}</span>
            )}
            {media.videoQuality === '4K' && <span className="quality uhd">4K</span>}
            {media.hdr && <span className="quality hdr">HDR</span>}
            {media.dolbyAtmos && (
              <span className="quality" style={{ background: 'rgba(0,90,170,0.2)', borderColor: 'rgba(0,90,170,0.4)', color: '#7ab3e0' }}>
                Atmos
              </span>
            )}
          </div>

          {/* Overview */}
          {media.overview && (
            <p style={{
              fontSize: '0.5rem', color: 'rgba(236,233,226,0.7)', lineHeight: 1.6,
              marginBottom: '1rem', maxWidth: '38rem',
              display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {media.overview}
            </p>
          )}

          {/* Director/cast if available */}
          {(media.director || (media.cast && media.cast.length > 0)) && (
            <div style={{ marginBottom: '1rem', display: 'flex', gap: '1.5rem' }}>
              {media.director && (
                <div>
                  <div className="uppercase-eyebrow" style={{ marginBottom: '0.2rem' }}>Réalisateur</div>
                  <div style={{ fontSize: '0.4rem', color: 'var(--text)' }}>{media.director}</div>
                </div>
              )}
              {media.cast && media.cast.length > 0 && (
                <div>
                  <div className="uppercase-eyebrow" style={{ marginBottom: '0.2rem' }}>Avec</div>
                  <div style={{ fontSize: '0.4rem', color: 'var(--text)' }}>
                    {(media.cast as Array<{ person?: { name: string }; name?: string }>)
                      .slice(0, 3)
                      .map((c) => c.person?.name ?? c.name ?? '')
                      .filter(Boolean)
                      .join(', ')}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
            {/* Primary play button */}
            <button
              data-focused={focused === 'play'}
              onFocus={() => setFocused('play')}
              onClick={() => {
                if (mediaType === 'movie') navigate({ name: 'player', mediaId, title, videoQuality: media?.videoQuality, hdr: media?.hdr });
                else if (hasTabs) setFocused({ zone: 'tab', idx: activeSeasonIdx });
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.31rem',
                background: focused === 'play' ? '#fff' : 'rgba(255,255,255,0.85)',
                color: '#0a0a0e', border: 'none',
                padding: '14px 26px', borderRadius: '4px',
                fontSize: '0.44rem', fontWeight: 600, cursor: 'pointer',
                outline: focused === 'play' ? '2px solid var(--accent)' : 'none',
                outlineOffset: '5px',
                boxShadow: focused === 'play' ? '0 0 0 7px rgba(177,58,48,0.12)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <path d="M2 2 L10 6 L2 10 Z" />
              </svg>
              {mediaType === 'series' ? 'Choisir un épisode' : (movieProgressPct > 1 ? 'Reprendre' : 'Regarder')}
            </button>

            {/* Secondary back button */}
            <button
              data-focused={focused === 'back'}
              onFocus={() => setFocused('back')}
              onClick={() => navigate({ name: 'home' })}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.31rem',
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid var(--line-strong)',
                padding: '14px 26px', borderRadius: '4px',
                color: '#fff',
                fontSize: '0.44rem', fontWeight: 600, cursor: 'pointer',
                outline: focused === 'back' ? '2px solid var(--accent)' : 'none',
                outlineOffset: '5px',
                boxShadow: focused === 'back' ? '0 0 0 7px rgba(177,58,48,0.12)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              ← Retour
            </button>
          </div>

          {/* Movie progress bar */}
          {mediaType === 'movie' && movieProgressPct > 1 && (
            <div style={{ marginBottom: '1rem', maxWidth: '18rem' }}>
              <div className="progress-bar" style={{ height: '3px' }}>
                <span style={{ width: `${movieProgressPct}%` }} />
              </div>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '0.34rem', color: 'var(--text-dim)', marginTop: '0.2rem', display: 'block' }}>
                {Math.round(movieProgressPct)}% REGARDÉ
              </span>
            </div>
          )}

          {/* Season tabs + episode carousel */}
          {hasTabs && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {/* Season tab bar — pill container */}
              <div
                ref={tabBarRef}
                style={{
                  display: 'inline-flex', gap: '3px', marginBottom: '0.75rem',
                  overflowX: 'auto',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--line-strong)',
                  borderRadius: '4px',
                  padding: '4px',
                  alignSelf: 'flex-start',
                }}
              >
                {seasonGroups.map((group, idx) => {
                  const isFocused = typeof focused === 'object' && focused.zone === 'tab' && focused.idx === idx;
                  const isActive = activeSeasonIdx === idx;
                  return (
                    <div
                      key={group.seasonNumber}
                      ref={isFocused ? focusedTabRef : undefined}
                      data-focused={isFocused}
                      onClick={() => { setActiveSeasonIdx(idx); setFocused({ zone: 'tab', idx }); }}
                      style={{
                        padding: '6px 14px', borderRadius: '3px',
                        background: isActive ? 'var(--accent)' : 'transparent',
                        border: 'none',
                        color: isActive ? '#fff' : 'var(--text-muted)',
                        fontSize: '0.38rem', fontWeight: isActive ? 600 : 400,
                        cursor: 'pointer', flexShrink: 0,
                        outline: isFocused ? '2px solid var(--accent)' : 'none',
                        outlineOffset: '5px',
                        transition: 'all 0.12s ease',
                      }}
                    >
                      S{group.seasonNumber}
                      <span style={{
                        fontFamily: 'var(--mono)',
                        marginLeft: '0.4rem', fontSize: '0.31rem', opacity: 0.65,
                      }}>
                        {group.episodes.length} ép.
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Episode horizontal carousel */}
              <div
                ref={episodeListRef}
                style={{
                  display: 'flex', gap: '12px',
                  overflowX: 'auto', paddingBottom: '0.5rem',
                  flex: 1, alignContent: 'flex-start',
                }}
              >
                {episodes.map((ep, idx) => {
                  const isFocused = typeof focused === 'object' && focused.zone === 'episode' && focused.idx === idx;
                  const epPct = watchProgress.pct(mediaId, ep.id);
                  const epTitle = ep.name || ep.title || '';
                  return (
                    <div
                      key={ep.id}
                      ref={isFocused ? focusedEpisodeRef : undefined}
                      data-focused={isFocused}
                      onClick={() => navigate({
                        name: 'player', mediaId, episodeId: ep.id,
                        title: `${title} · S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}`,
                        videoQuality: media?.videoQuality, hdr: media?.hdr,
                      })}
                      style={{
                        width: '320px', flexShrink: 0,
                        borderRadius: '6px', overflow: 'hidden', cursor: 'pointer',
                        background: 'var(--bg-card)',
                        outline: isFocused ? '2px solid var(--accent)' : '2px solid transparent',
                        outlineOffset: '5px',
                        boxShadow: isFocused
                          ? '0 0 0 7px rgba(177,58,48,0.12), 0 16px 48px rgba(0,0,0,0.7)'
                          : '0 2px 8px rgba(0,0,0,0.5)',
                        transition: 'all 0.12s ease',
                        zIndex: isFocused ? 10 : 1,
                      }}
                    >
                      {/* Thumbnail — 16:9, 320×180 */}
                      <div style={{ width: '320px', height: '180px', position: 'relative', background: 'linear-gradient(135deg, #1a1a2e, #27272a)' }}>
                        {ep.stillUrl && (
                          <img
                            src={ep.stillUrl}
                            alt={epTitle}
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          />
                        )}
                        {/* Episode number badge top-left */}
                        <div style={{
                          position: 'absolute', top: '0.4rem', left: '0.4rem',
                          fontFamily: 'var(--mono)',
                          fontSize: '0.31rem', fontWeight: 600,
                          color: 'rgba(255,255,255,0.9)',
                          background: 'rgba(0,0,0,0.6)',
                          padding: '2px 6px', borderRadius: '3px',
                          letterSpacing: '0.06em',
                        }}>
                          E{String(ep.episodeNumber).padStart(2, '0')}
                        </div>

                        {/* Duration badge bottom-right */}
                        {ep.runtime && ep.runtime > 0 && (
                          <div style={{
                            position: 'absolute', bottom: '0.4rem', right: '0.4rem',
                            fontFamily: 'var(--mono)',
                            fontSize: '0.31rem', color: 'rgba(255,255,255,0.7)',
                            background: 'rgba(0,0,0,0.5)',
                            padding: '2px 6px', borderRadius: '3px',
                          }}>
                            {ep.runtime} min
                          </div>
                        )}

                        {/* Progress bar at bottom */}
                        {epPct > 1 && (
                          <div style={{
                            position: 'absolute', bottom: 0, left: 0, right: 0,
                            height: '4px', background: 'rgba(255,255,255,0.12)',
                          }}>
                            <div style={{ height: '100%', width: `${epPct}%`, background: 'var(--accent)' }} />
                          </div>
                        )}
                      </div>

                      {/* Info below thumbnail */}
                      <div style={{ padding: '0.4rem 0.5rem 0.5rem' }}>
                        {epTitle && (
                          <div style={{
                            fontFamily: 'var(--serif)',
                            fontSize: '0.44rem', fontWeight: 400,
                            color: isFocused ? '#fff' : 'var(--text)',
                            lineHeight: 1.2, marginBottom: '0.2rem',
                            display: '-webkit-box', WebkitLineClamp: 1,
                            WebkitBoxOrient: 'vertical', overflow: 'hidden',
                          }}>
                            {epTitle}
                          </div>
                        )}
                        {ep.overview && (
                          <div style={{
                            fontFamily: 'var(--mono)',
                            fontSize: '0.31rem', color: 'var(--text-dim)',
                            lineHeight: 1.4,
                            display: '-webkit-box', WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical', overflow: 'hidden',
                          }}>
                            {ep.overview}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
