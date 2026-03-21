import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { KEY, useRemoteKeys } from '../hooks/useRemoteKeys';
import type { MediaTracks } from '../lib/api';

interface Props {
  url: string;
  isHls: boolean;
  durationSeconds: number;
  tracks?: MediaTracks;
  onBack: () => void;
}

function formatTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function channelLabel(n: number): string {
  if (n >= 8) return '7.1';
  if (n >= 6) return '5.1';
  if (n >= 3) return '2.1';
  if (n === 2) return 'Stéréo';
  return 'Mono';
}

type TrackSection = 'audio' | 'subtitle';

export default function VideoPlayer({ url, isHls, durationSeconds, tracks, onBack }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Track menu state
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuSection, setMenuSection] = useState<TrackSection>('audio');
  const [menuIndex, setMenuIndex] = useState(0);
  const [activeAudio, setActiveAudio] = useState(0);
  const [activeSubtitle, setActiveSubtitle] = useState(-1); // -1 = désactivé

  const showControlsFor = (ms = 3000) => {
    setShowControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowControls(false), ms);
  };

  // Mount HLS or native
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch((_e: unknown) => {});
      });
    } else {
      video.src = url;
      video.play().catch((_e: unknown) => {});
    }

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [url, isHls]);

  // Sync playing state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setCurrentTime(video.currentTime);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTime);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTime);
    };
  }, []);

  const applyAudioTrack = (index: number) => {
    const video = videoRef.current;
    if (!video) return;
    // Native audioTracks API (fonctionne sur certaines implémentations webOS)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const audioTracks = (video as any).audioTracks as { length: number; [i: number]: { enabled: boolean } } | undefined;
    if (audioTracks && audioTracks.length > 0) {
      for (let i = 0; i < audioTracks.length; i++) {
        audioTracks[i].enabled = (i === index);
      }
    }
    setActiveAudio(index);
  };

  const applySubtitle = (index: number) => {
    const video = videoRef.current;
    if (!video) return;
    const textTracks = video.textTracks;
    for (let i = 0; i < textTracks.length; i++) {
      textTracks[i].mode = (i === index) ? 'showing' : 'disabled';
    }
    setActiveSubtitle(index);
  };

  const currentItems = menuSection === 'audio'
    ? (tracks?.audio ?? [])
    : [{ index: -1, title: 'Désactivés', language: '', codec: '' }, ...(tracks?.subtitles ?? [])];

  useRemoteKeys((e) => {
    const video = videoRef.current;
    if (!video) return;

    if (menuOpen) {
      e.preventDefault();
      if (e.keyCode === KEY.BACK) {
        setMenuOpen(false);
        showControlsFor(3000);
      } else if (e.keyCode === KEY.UP) {
        setMenuIndex((i) => Math.max(0, i - 1));
      } else if (e.keyCode === KEY.DOWN) {
        setMenuIndex((i) => Math.min(currentItems.length - 1, i + 1));
      } else if (e.keyCode === KEY.LEFT) {
        setMenuSection('audio');
        setMenuIndex(0);
      } else if (e.keyCode === KEY.RIGHT) {
        setMenuSection('subtitle');
        setMenuIndex(0);
      } else if (e.keyCode === KEY.OK) {
        const item = currentItems[menuIndex];
        if (!item) return;
        if (menuSection === 'audio') {
          applyAudioTrack(item.index as number);
        } else {
          applySubtitle(item.index as number);
        }
        setMenuOpen(false);
        showControlsFor(3000);
      }
      return;
    }

    showControlsFor();

    if (e.keyCode === KEY.UP) {
      e.preventDefault();
      if (tracks && (tracks.audio.length > 1 || tracks.subtitles.length > 0)) {
        setMenuSection('audio');
        setMenuIndex(activeAudio);
        setMenuOpen(true);
        clearTimeout(hideTimer.current);
        setShowControls(true);
      }
    } else if (e.keyCode === KEY.BACK) {
      e.preventDefault();
      onBack();
    } else if (e.keyCode === KEY.OK || e.keyCode === KEY.PLAY_PAUSE || e.keyCode === KEY.PLAY || e.keyCode === KEY.PAUSE) {
      e.preventDefault();
      if (video.paused) video.play();
      else video.pause();
    } else if (e.keyCode === KEY.FF) {
      e.preventDefault();
      video.currentTime = Math.min(video.currentTime + 30, video.duration || 0);
    } else if (e.keyCode === KEY.RW) {
      e.preventDefault();
      video.currentTime = Math.max(video.currentTime - 10, 0);
    } else if (e.keyCode === KEY.RIGHT) {
      e.preventDefault();
      video.currentTime = Math.min(video.currentTime + 10, video.duration || 0);
    } else if (e.keyCode === KEY.LEFT) {
      e.preventDefault();
      video.currentTime = Math.max(video.currentTime - 10, 0);
    } else if (e.keyCode === KEY.STOP) {
      e.preventDefault();
      onBack();
    }
  }, [onBack, menuOpen, menuSection, menuIndex, currentItems, activeAudio, tracks]);

  const duration = durationSeconds || videoRef.current?.duration || 0;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const hasMenu = tracks && (tracks.audio.length > 1 || tracks.subtitles.length > 0);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
      <video
        ref={videoRef}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        playsInline
      />

      {/* Track menu */}
      {menuOpen && (
        <div style={{
          position: 'absolute',
          bottom: '7rem',
          left: '3rem',
          background: 'rgba(15,15,15,0.97)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '12px',
          padding: '1rem',
          minWidth: '280px',
          maxWidth: '360px',
        }}>
          {/* Section tabs */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
            {(['audio', 'subtitle'] as TrackSection[]).map((s) => (
              <button
                key={s}
                onClick={() => { setMenuSection(s); setMenuIndex(0); }}
                style={{
                  flex: 1,
                  padding: '0.4rem 0',
                  borderRadius: '6px',
                  border: 'none',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: menuSection === s ? 'var(--red)' : 'rgba(255,255,255,0.08)',
                  color: '#fff',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                }}
              >
                {s === 'audio' ? '🔊 Audio' : '💬 Sous-titres'}
              </button>
            ))}
          </div>

          {/* Items */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {currentItems.map((item, i) => {
              const isActive = menuSection === 'audio'
                ? (item.index === activeAudio)
                : (item.index === activeSubtitle);
              const isFocused = i === menuIndex;
              const audioItem = menuSection === 'audio' ? (item as { index: number; title: string; codec: string; channels: number; language: string }) : null;
              return (
                <div
                  key={item.index}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    padding: '0.5rem 0.6rem',
                    borderRadius: '6px',
                    background: isFocused ? 'rgba(229,9,20,0.25)' : 'transparent',
                    border: isFocused ? '1px solid rgba(229,9,20,0.6)' : '1px solid transparent',
                  }}
                >
                  <span style={{ fontSize: '0.7rem', color: isActive ? '#e50914' : 'rgba(255,255,255,0.2)', flexShrink: 0 }}>●</span>
                  <span style={{ flex: 1, fontSize: '0.82rem', color: isFocused ? '#fff' : 'rgba(255,255,255,0.75)' }}>
                    {item.title}
                    {audioItem && (
                      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.7rem', marginLeft: '0.4rem' }}>
                        {audioItem.codec} · {channelLabel(audioItem.channels)}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
            {currentItems.length === 0 && (
              <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)', padding: '0.4rem 0.6rem' }}>
                Aucune piste disponible
              </span>
            )}
          </div>

          <div style={{ marginTop: '0.75rem', fontSize: '0.65rem', color: 'rgba(255,255,255,0.25)', textAlign: 'center' }}>
            ↑↓ naviguer · ←→ audio/sous-titres · OK confirmer · BACK fermer
          </div>
        </div>
      )}

      {/* Controls overlay */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '2rem 3rem',
          background: 'linear-gradient(transparent, rgba(0,0,0,0.85))',
          opacity: showControls ? 1 : 0,
          transition: 'opacity 0.3s ease',
          pointerEvents: 'none',
        }}
      >
        {/* Progress bar */}
        <div
          style={{
            height: '4px',
            background: 'rgba(255,255,255,0.3)',
            borderRadius: '2px',
            marginBottom: '0.75rem',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progress}%`,
              background: 'var(--red)',
              borderRadius: '2px',
              transition: 'width 0.5s linear',
            }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '1.5rem' }}>{playing ? '⏸' : '▶'}</span>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
            {activeSubtitle >= 0 && tracks?.subtitles[activeSubtitle] && (
              <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)' }}>
                💬 {tracks.subtitles[activeSubtitle].title}
              </span>
            )}
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {hasMenu ? '↑ Pistes · ' : ''}BACK pour quitter
          </span>
        </div>
      </div>
    </div>
  );
}
