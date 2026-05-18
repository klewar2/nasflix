import { useRef } from 'react';
import type { MediaTracks, NasSubtitleTrack } from '../lib/api';
import { watchProgress } from '../lib/progress';
import { useVideoCore } from '../hooks/useVideoCore';
import { useVideoTracks } from '../hooks/useVideoTracks';
import { useWatchProgress } from '../hooks/useWatchProgress';
import { usePlayerNav } from '../hooks/usePlayerNav';
import { channelLabel, formatTime, langName } from '../hooks/utils';

interface Props {
  url: string;
  isHls: boolean;
  durationSeconds: number;
  title?: string;
  tracks?: MediaTracks;
  mediaId: number;
  episodeId?: number;
  sourceType?: 'NAS' | 'SEEDBOX';
  jellyfinItemId?: string;
  jellyfinBaseUrl?: string;
  jellyfinApiToken?: string;
  nasSubtitleCache?: NasSubtitleTrack[];
  videoQuality?: string;
  hdr?: boolean;
  onBack: () => void;
  onNextEpisode?: () => void;
  onPrevEpisode?: () => void;
}

export default function VideoPlayer({
  url, isHls, durationSeconds, title, tracks, mediaId, episodeId,
  sourceType, jellyfinItemId, jellyfinBaseUrl, jellyfinApiToken, nasSubtitleCache,
  videoQuality, hdr, onBack, onNextEpisode, onPrevEpisode,
}: Props) {
  // savedProgress computed once (synchronous localStorage read)
  const savedProgressRef = useRef(watchProgress.get(mediaId, episodeId));
  const savedProgress = savedProgressRef.current;

  const {
    videoRef, hlsRef, playing, currentTime, isBuffering, videoError,
    hlsAudioTracks, setHlsAudioTracks, activeAudio, setActiveAudio,
    urlChangeKey, debugLogs, tvLog: _tvLog,
  } = useVideoCore({ url, isHls, mediaId, episodeId, durationSeconds, savedProgress });

  const {
    savedProgress: _sp, showResume, setShowResume, resumeCountdown,
  } = useWatchProgress({ videoRef, mediaId, episodeId, durationSeconds, initialSavedProgress: savedProgress });

  const {
    effectiveAudioTracks, effectiveSubtitles, activeSubtitle,
    activeCueHtml, subtitleLoading, nativeAudioTracks, nativeSubtitleTracks,
    applyAudioTrack, applySubtitle,
  } = useVideoTracks({
    videoRef, hlsRef, url, isHls, hlsAudioTracks, setHlsAudioTracks, setActiveAudio,
    tracks, sourceType, jellyfinItemId, jellyfinBaseUrl, jellyfinApiToken,
    currentTime, mediaId, episodeId, urlChangeKey, nasSubtitleCache,
  });

  const nav = usePlayerNav({
    videoRef, playing, currentTime, durationSeconds, effectiveAudioTracks, effectiveSubtitles,
    activeAudio, activeSubtitle, applyAudioTrack, applySubtitle,
    onBack, onNextEpisode, onPrevEpisode, mediaId, episodeId, showResume, setShowResume, savedProgress,
  });

  const DEBUG = import.meta.env.VITE_DEBUG === 'true';

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
      <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'contain' }} playsInline />

      {/* ── Subtitle overlay (TV-optimised) ─────────────────────────── */}
      {activeCueHtml && (
        <div style={{
          position: 'absolute',
          bottom: nav.showControls ? '22%' : '6%',
          left: '10%', right: '10%',
          textAlign: 'center', pointerEvents: 'none', zIndex: 20,
          transition: 'bottom 0.3s ease',
        }}>
          <span
            style={{
              display: 'inline-block', color: '#fff',
              fontSize: '0.875rem', fontFamily: 'Arial, Helvetica, sans-serif',
              fontWeight: 500, lineHeight: 1.4,
              background: "transparent",
              maxWidth: '100%',
            }}
            // VTT may contain <b>/<i> — sourced from our own Jellyfin server
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: activeCueHtml }}
          />
        </div>
      )}

      {/* ── Subtitle loading indicator ───────────────────────────────── */}
      {subtitleLoading && (
        <div style={{
          position: 'absolute', bottom: '6%', right: '3%', zIndex: 20,
          background: 'rgba(0,0,0,0.7)', borderRadius: '4px',
          padding: '0.25rem 0.6rem',
          fontFamily: 'var(--mono)', fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)',
          pointerEvents: 'none',
        }}>
          Chargement sous-titres…
        </div>
      )}

      {/* ── Buffering loader ─────────────────────────────────────────── */}
      {isBuffering && !videoError && !showResume && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: '0.625rem', pointerEvents: 'none', background: 'rgba(0,0,0,0.35)',
        }}>
          <div style={{
            width: '2rem', height: '2rem',
            border: '2px solid rgba(255,255,255,0.1)', borderTop: '2px solid var(--accent)',
            borderRadius: '50%', animation: 'nasflix-spin 0.8s linear infinite',
          }} />
          <span style={{ color: 'rgba(255,255,255,0.6)', fontFamily: 'var(--mono)', fontSize: '0.34rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            BUFFER…
          </span>
          <style>{`@keyframes nasflix-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* ── Debug panel ─────────────────────────────────────────────── */}
      {DEBUG && (
        <div style={{
          position: 'absolute', top: '12px', left: '12px', zIndex: 9999,
          background: 'rgba(0,0,0,0.92)', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: '8px', padding: '10px 14px', fontFamily: 'monospace',
          fontSize: '11px', minWidth: '320px', maxWidth: '420px', pointerEvents: 'none',
        }}>
          <div style={{ color: '#e50914', fontWeight: 700, marginBottom: '6px' }}>🎵 DEBUG TRACKS</div>
          <div style={{ marginBottom: '4px', color: 'rgba(255,255,255,0.5)' }}>
            HLS audio ({hlsAudioTracks.length}) | native audio ({nativeAudioTracks.length}) | native subs ({nativeSubtitleTracks.length})
          </div>
          <div style={{ color: 'rgba(255,255,255,0.5)' }}>
            navMode: <span style={{ color: '#4ade80' }}>{nav.navMode}</span>
            {' '}| transportFocus: <span style={{ color: '#4ade80' }}>{nav.transportFocus}</span>
          </div>
          {tracks?.audio.map(t => (
            <div key={t.index} style={{ color: '#fff', marginBottom: '2px' }}>
              [{t.index}] {t.title} ({t.language}) {t.codec} {t.channels}ch
            </div>
          ))}
        </div>
      )}

      {/* ── Resume prompt ───────────────────────────────────────────── */}
      {showResume && savedProgress && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'rgba(14,14,18,0.88)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid var(--line-strong)', borderRadius: '0.5rem',
            padding: '1.25rem 1.5rem', textAlign: 'center', maxWidth: '17.5rem',
          }}>
            <div className="uppercase-eyebrow" style={{ marginBottom: '0.4375rem' }}>Reprendre la lecture ?</div>
            {title && (
              <h2 style={{ fontFamily: 'var(--serif)', fontSize: '1.1875rem', fontWeight: 400, marginBottom: '0.1875rem', color: '#fff' }}>
                {title}
              </h2>
            )}
            <div style={{ fontFamily: 'var(--mono)', fontSize: '2.25rem', fontWeight: 500, color: 'var(--accent)', marginBottom: '0.125rem', fontVariantNumeric: 'tabular-nums' }}>
              {formatTime(savedProgress.currentTime)}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '0.375rem', color: 'var(--text-dim)', marginBottom: '0.875rem' }}>
              sur {formatTime(savedProgress.duration)} · {formatTime(Math.max(0, savedProgress.duration - savedProgress.currentTime))} restantes
            </div>
            <div style={{ display: 'flex', gap: '0.375rem', justifyContent: 'center', marginBottom: '0.5rem' }}>
              <button style={{
                background: '#fff', color: '#0a0a0e', border: 'none',
                padding: '0.375rem 0.75rem', borderRadius: '4px',
                fontSize: '0.44rem', fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '0.25rem',
              }} onClick={nav.doResume}>
                <svg width="10" height="10" viewBox="0 0 12 12"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor"/></svg>
                Reprendre
              </button>
              <button style={{
                background: 'rgba(255,255,255,0.08)', color: '#fff',
                border: '1px solid var(--line-strong)',
                padding: '0.375rem 0.6875rem', borderRadius: '4px',
                fontSize: '0.44rem', cursor: 'pointer',
              }} onClick={nav.doStartOver}>
                ↻ Recommencer
              </button>
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '0.3125rem', color: 'var(--text-dim)', letterSpacing: '0.1em' }}>
              REPRISE AUTOMATIQUE DANS {resumeCountdown} SEC.
            </div>
          </div>
        </div>
      )}

      {/* ── Seek hint (center) ────────────────────────────────────────── */}
      {nav.seekHint && !nav.seekMode && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          background: 'rgba(0,0,0,0.75)', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '0.5rem', padding: '0.4375rem 1rem',
          fontFamily: 'var(--mono)', fontSize: '1.125rem', fontWeight: 700,
          color: '#fff', pointerEvents: 'none', letterSpacing: '0.06em',
        }}>
          {nav.seekHint}
        </div>
      )}

      {/* ── Controls overlay ──────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', inset: 0,
        opacity: nav.showControls ? 1 : 0, transition: 'opacity 0.3s',
        pointerEvents: nav.showControls ? 'auto' : 'none',
      }}>

        {/* TOP BAR */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          padding: '0.875rem 2rem',
          display: 'flex', alignItems: 'center', gap: '0.5625rem',
          background: 'linear-gradient(180deg, rgba(0,0,0,0.8) 0%, transparent 100%)',
          pointerEvents: 'none',
        }}>
          <button onClick={onBack} style={{
            display: 'flex', alignItems: 'center', gap: '0.3125rem',
            padding: '0.25rem 0.4375rem',
            background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '4px', color: '#fff', cursor: 'pointer', pointerEvents: 'auto',
          }}>
            <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
              <path d="M9 2L4 7l5 5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.34rem', letterSpacing: '0.08em' }}>RETOUR</span>
          </button>
          {title && (
            <div>
              <div className="uppercase-eyebrow" style={{ fontSize: '0.3rem' }}>{title}</div>
            </div>
          )}
          <div style={{ flex: 1 }} />
          {videoQuality === '4K' && <span className="quality uhd">4K</span>}
          {hdr && <span className="quality hdr">HDR</span>}
          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.375rem', color: 'rgba(255,255,255,0.6)' }}>
            {nav.clockTime}
          </span>
        </div>

        {/* BOTTOM PANEL */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          background: 'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.65) 30%, rgba(0,0,0,0.97) 100%)',
          padding: '3.75rem 2rem 1rem',
        }}>
          {/* Tabs: Lecture / Audio / Sous-titres */}
          <div style={{ display: 'flex', gap: '0.1875rem', marginBottom: '0.875rem', alignItems: 'center' }}>
            {[
              { id: 'play' as const, label: 'Lecture', sub: null, active: !nav.menuOpen },
              { id: 'audio' as const, label: 'Audio', sub: nav.audioSummary, active: nav.menuOpen && nav.menuSection === 'audio' },
              { id: 'subtitle' as const, label: 'Sous-titres', sub: nav.subSummary, active: nav.menuOpen && nav.menuSection === 'subtitle' },
            ].map((tab) => (
              <div
                key={tab.id}
                onClick={() => {
                  if (tab.id === 'play') { nav.showControlsFor(); }
                  else {
                    // Opening menu via click sets navMode to 'menu'
                    // We mimic nav internal logic via the state ref - but for click we can just toggle
                    // Since nav doesn't expose setMenuSection, clicks work through DOM interaction
                  }
                }}
                style={{
                  padding: '0.3125rem 0.5625rem', borderRadius: '4px',
                  background: tab.active ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${tab.active ? 'rgba(255,255,255,0.25)' : 'var(--line-strong)'}`,
                  display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '3.75rem',
                  cursor: 'pointer',
                  outline: tab.active ? '3px solid rgba(255,255,255,0.5)' : 'none', outlineOffset: '3px',
                }}
              >
                <span style={{ fontSize: '0.41rem', fontWeight: 500, color: tab.active ? '#fff' : 'var(--text-muted)' }}>
                  {tab.label}
                </span>
                {tab.sub && (
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '0.3rem', color: 'var(--text-dim)' }}>
                    {tab.sub}
                  </span>
                )}
              </div>
            ))}
            <div style={{ flex: 1 }} />
            <span className="chip" style={{ fontSize: '0.3rem' }}>
              {nav.seekMode ? '◀▶ ±30s · OK valider · BACK annuler' : '↑ Scrub · ↓ Transport · ←→ ±10s'}
            </span>
          </div>

          {/* Track list (when menu open) */}
          {nav.menuOpen && (
            <div style={{
              marginBottom: '0.875rem', maxHeight: '7.5rem', overflowY: 'auto',
              display: 'flex', flexDirection: 'column', gap: '2px',
            }}>
              {nav.currentItems.map((item, i) => {
                const isActive = nav.menuSection === 'audio' ? (i === activeAudio) : (item.index === activeSubtitle);
                const isFocused = i === nav.menuIndex;
                const audioItem = nav.menuSection === 'audio'
                  ? (item as { index: number; title: string; codec: string; channels?: number; language: string })
                  : null;
                return (
                  <div key={item.index} style={{
                    display: 'flex', alignItems: 'center', gap: '0.4375rem',
                    padding: '0.4375rem 0.5rem', borderRadius: '4px',
                    background: isFocused ? 'var(--accent-soft)' : isActive ? 'rgba(255,255,255,0.04)' : 'transparent',
                    border: `1px solid ${isFocused ? 'var(--accent-line)' : 'transparent'}`,
                    cursor: 'pointer',
                  }}>
                    <span style={{
                      width: '0.25rem', height: '0.25rem', borderRadius: '50%', flexShrink: 0,
                      background: isActive ? 'var(--accent)' : 'transparent',
                      border: '1px solid var(--line-strong)',
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.44rem', color: isFocused ? '#fff' : 'var(--text)', fontWeight: 500 }}>
                        {item.title}
                        {item.language && langName(item.language) !== item.title && (
                          <span style={{ color: 'var(--text-dim)', fontSize: '0.34rem', marginLeft: '0.375rem' }}>
                            {langName(item.language)}
                          </span>
                        )}
                      </div>
                      {audioItem && audioItem.codec && (
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '0.3rem', color: 'var(--text-dim)', marginTop: '1px' }}>
                          {[audioItem.codec, (audioItem.channels ?? 0) > 0 ? channelLabel(audioItem.channels!) : ''].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </div>
                    {isActive && <span className="chip accent" style={{ fontSize: '0.28rem' }}>ACTIF</span>}
                  </div>
                );
              })}
              {nav.currentItems.length === 0 && (
                <span style={{ fontFamily: 'var(--mono)', fontSize: '0.38rem', color: 'var(--text-dim)', padding: '0.25rem 0.5rem' }}>
                  Aucune piste disponible
                </span>
              )}
            </div>
          )}

          {/* Timeline */}
          <div style={{ position: 'relative', marginBottom: '0.875rem' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '0.5rem' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '1.75rem', color: '#fff', fontWeight: 500, letterSpacing: '0.02em', fontVariantNumeric: 'tabular-nums' }}>
                {formatTime(nav.displayTime)}
              </span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '0.4375rem', color: 'rgba(255,255,255,0.4)', marginLeft: '0.375rem' }}>
                / {formatTime(nav.duration)}
              </span>
              <div style={{ flex: 1 }} />
              {nav.seekMode && (
                <span style={{
                  display: 'flex', alignItems: 'center', gap: '0.3125rem',
                  padding: '0.1875rem 0.4375rem',
                  background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', borderRadius: '4px',
                }}>
                  <span style={{ width: '0.25rem', height: '0.25rem', borderRadius: '50%', background: 'var(--accent)', animation: 'pulse-soft 2s ease-in-out infinite' }} />
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '0.375rem', color: '#e8b3ad', letterSpacing: '0.08em' }}>SCRUB</span>
                </span>
              )}
              <span style={{ fontFamily: 'var(--mono)', fontSize: '0.375rem', color: 'rgba(255,255,255,0.5)', marginLeft: '0.5625rem' }}>
                −{formatTime(Math.max(0, nav.duration - nav.displayTime))} restantes
              </span>
            </div>
            {/* Progress bar */}
            <div style={{ position: 'relative', height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.15)', overflow: 'visible' }}>
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: `${nav.progress}%`,
                background: nav.seekMode ? '#fff' : 'var(--accent)', borderRadius: '3px',
                transition: nav.seekMode ? 'none' : 'width 0.5s linear',
              }} />
              <div style={{
                position: 'absolute', left: `${nav.progress}%`, top: '50%', transform: 'translate(-50%, -50%)',
                width: nav.seekMode ? '1.375rem' : '1rem', height: nav.seekMode ? '1.375rem' : '1rem',
                borderRadius: '50%', background: '#fff',
                boxShadow: nav.seekMode ? '0 0 0 5px var(--accent), 0 0 24px rgba(177,58,48,0.6)' : '0 0 0 3px var(--accent)',
                transition: nav.seekMode ? 'none' : 'left 0.5s linear', willChange: 'left',
              }} />
              {nav.seekMode && nav.pendingSeekTime !== null && (
                <div style={{
                  position: 'absolute', left: `${nav.progress}%`, bottom: '1.125rem', transform: 'translateX(-50%)',
                  width: '7.5rem', height: '4.21875rem', borderRadius: '4px', overflow: 'hidden',
                  border: '2px solid #fff', boxShadow: '0 10px 40px rgba(0,0,0,0.8)',
                  background: 'linear-gradient(135deg, #1a1a22, #0a0a0e)',
                  display: 'flex', alignItems: 'flex-end', padding: '0.1875rem 0.25rem',
                }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '0.3rem', color: '#fff', background: 'rgba(0,0,0,0.7)', padding: '1px 4px', borderRadius: '2px' }}>
                    {formatTime(nav.displayTime)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Transport row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4375rem' }}>
              {/* Prev episode (SkipBack) si dispo, sinon Restart */}
              <RoundBtn size={46} focused={nav.navMode === 'transport' && nav.transportFocus === 0}
                onClick={() => nav.activateTransportBtn(0)}>
                {nav.hasPrevEpisode ? (
                  <svg width="13" height="13" viewBox="0 0 13 13"><path d="M10 1.5v10l-8-5z M2 1.5v10" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/></svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 13 13"><path d="M11 1.5L2 6.5l9 5z" fill="currentColor"/><rect x="1" y="1.5" width="1.5" height="10" fill="currentColor"/></svg>
                )}
              </RoundBtn>
              {/* −10s */}
              <RoundBtn size={46} sub="−10" focused={nav.navMode === 'transport' && nav.transportFocus === 1}
                onClick={() => nav.activateTransportBtn(1)}>
                <svg width="14" height="14" viewBox="0 0 14 14"><path d="M12 7a5 5 0 1 1-5-5V0L3.5 3.5 7 7" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </RoundBtn>
              {/* Play/Pause */}
              <RoundBtn size={64} big focused={nav.navMode === 'transport' && nav.transportFocus === 2}
                onClick={() => nav.activateTransportBtn(2)}>
                {playing
                  ? <svg width="18" height="18" viewBox="0 0 18 18"><rect x="2" y="2" width="5" height="14" rx="1" fill="currentColor"/><rect x="11" y="2" width="5" height="14" rx="1" fill="currentColor"/></svg>
                  : <svg width="18" height="18" viewBox="0 0 18 18"><path d="M4 2v14l12-7z" fill="currentColor"/></svg>
                }
              </RoundBtn>
              {/* +10s */}
              <RoundBtn size={46} sub="+10" focused={nav.navMode === 'transport' && nav.transportFocus === 3}
                onClick={() => nav.activateTransportBtn(3)}>
                <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 7a5 5 0 1 0 5-5V0L10.5 3.5 7 7" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </RoundBtn>
              {/* Next episode — affiché uniquement si dispo */}
              {nav.hasNextEpisode && (
                <RoundBtn size={46} focused={nav.navMode === 'transport' && nav.transportFocus === 4}
                  onClick={() => nav.activateTransportBtn(4)}>
                  <svg width="13" height="13" viewBox="0 0 13 13"><path d="M3 1.5v10l8-5z M11 1.5v10" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/></svg>
                </RoundBtn>
              )}
            </div>

            <div style={{ flex: 1 }} />

            {/* Track summary chips */}
            {nav.hasTracks && (
              <div style={{ display: 'flex', gap: '0.375rem' }}>
                <span className="chip" style={{ fontSize: '0.34rem' }}>🔊 {nav.audioSummary}</span>
                <span className="chip" style={{ fontSize: '0.34rem', color: activeSubtitle >= 0 ? 'var(--text)' : 'var(--text-dim)' }}>
                  💬 {nav.subSummary}
                </span>
              </div>
            )}

            {/* Prev / Next episode text buttons */}
            {onPrevEpisode && (
              <button onClick={onPrevEpisode} style={{
                background: 'rgba(255,255,255,0.06)', color: '#fff',
                border: '1px solid var(--line-strong)', borderRadius: '4px',
                padding: '0.3125rem 0.5625rem', fontSize: '0.41rem', fontWeight: 500,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem',
              }}>
                <svg width="13" height="13" viewBox="0 0 13 13"><path d="M10 1v11l-8-5.5z M2 1v11" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/></svg>
                Épisode précédent
              </button>
            )}
            {onNextEpisode && (
              <button onClick={onNextEpisode} style={{
                background: 'rgba(255,255,255,0.06)', color: '#fff',
                border: '1px solid var(--line-strong)', borderRadius: '4px',
                padding: '0.3125rem 0.5625rem', fontSize: '0.41rem', fontWeight: 500,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem',
              }}>
                <svg width="13" height="13" viewBox="0 0 13 13"><path d="M3 1v11l8-5.5z M11 1v11" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/></svg>
                Épisode suivant
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Error overlay ────────────────────────────────────────────── */}
      {videoError && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: '0.75rem',
          background: 'rgba(0,0,0,0.88)',
        }}>
          <span style={{ fontSize: '2rem' }}>⚠️</span>
          <span style={{ color: '#e50914', fontSize: '1rem', fontWeight: 700 }}>Erreur de lecture</span>
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem' }}>
            Code {videoError.code} — {videoError.message || 'Format non supporté'}
          </span>
          <button onClick={onBack} style={{
            marginTop: '0.5rem', padding: '0.5rem 1.5rem', background: '#e50914',
            border: 'none', borderRadius: '6px', color: '#fff', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
          }}>
            ← Retour
          </button>
        </div>
      )}

      {/* ── Debug log overlay ────────────────────────────────────────── */}
      {DEBUG && (
        <div style={{
          position: 'absolute', top: 8, left: 8, right: 8,
          background: 'rgba(0,0,0,0.9)', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '8px', padding: '10px 14px',
          fontFamily: 'monospace', fontSize: '10px', maxHeight: '45vh', overflowY: 'auto',
          pointerEvents: 'none', zIndex: 9999,
        }}>
          <div style={{ color: '#e50914', fontWeight: 700, marginBottom: '6px' }}>📺 DEBUG PLAYER</div>
          <div style={{ color: 'rgba(255,255,255,0.6)', marginBottom: '4px' }}>
            url: <span style={{ color: '#fff', wordBreak: 'break-all' }}>{url.slice(0, 100)}{url.length > 100 ? '…' : ''}</span>
          </div>
          <div style={{ marginTop: '6px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '6px' }}>
            {debugLogs.map((l, i) => (
              <div key={i} style={{ color: l.includes('error') || l.includes('ERROR') ? '#f87171' : 'rgba(255,255,255,0.7)', marginBottom: '2px', wordBreak: 'break-all' }}>
                {l}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RoundBtn({ size, big, sub, focused, onClick, children }: {
  size: number; big?: boolean; sub?: string; focused?: boolean;
  onClick?: () => void; children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        width: `${size / 32}rem`, height: `${size / 32}rem`, borderRadius: '50%',
        background: big ? '#fff' : 'rgba(255,255,255,0.08)',
        border: big ? 'none' : '1px solid rgba(255,255,255,0.15)',
        color: big ? '#0a0a0e' : '#fff',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        cursor: onClick ? 'pointer' : 'default',
        position: 'relative', flexShrink: 0,
        transition: 'transform 0.15s, outline 0.15s',
        outline: focused ? '3px solid var(--accent)' : 'none',
        outlineOffset: '4px',
        transform: focused ? 'scale(1.15)' : 'scale(1)',
        boxShadow: focused ? '0 0 18px rgba(229,9,20,0.45)' : undefined,
      }}
    >
      {children}
      {sub && (
        <span style={{
          fontFamily: 'var(--mono)', fontSize: '0.25rem',
          position: 'absolute', bottom: '0.15rem',
          color: big ? '#0a0a0e' : 'rgba(255,255,255,0.5)',
        }}>
          {sub}
        </span>
      )}
    </div>
  );
}
