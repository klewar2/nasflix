import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { KEY, useRemoteKeys } from '../hooks/useRemoteKeys';

interface Props {
  url: string;
  isHls: boolean;
  durationSeconds: number;
  onBack: () => void;
}

function formatTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export default function VideoPlayer({ url, isHls, durationSeconds, onBack }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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

  useRemoteKeys((e) => {
    const video = videoRef.current;
    if (!video) return;

    showControlsFor();

    if (e.keyCode === KEY.BACK) {
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
  }, [onBack]);

  const duration = durationSeconds || videoRef.current?.duration || 0;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
      <video
        ref={videoRef}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        playsInline
      />

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
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            BACK pour quitter
          </span>
        </div>
      </div>
    </div>
  );
}
