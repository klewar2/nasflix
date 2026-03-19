import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Maximize, Minimize, Pause, Play, Volume2, VolumeX, X } from 'lucide-react';

interface VideoPlayerModalProps {
  url: string;
  title: string;
  onClose: () => void;
}

export function VideoPlayerModal({ url, title, onClose }: VideoPlayerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [buffering, setBuffering] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const formatTime = (s: number) => {
    if (!isFinite(s) || s < 0) return '0:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  const scheduleHide = useCallback((isPlaying: boolean) => {
    clearTimeout(hideTimer.current);
    setShowControls(true);
    if (isPlaying) {
      hideTimer.current = setTimeout(() => setShowControls(false), 3000);
    }
  }, []);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  useEffect(() => {
    const onFsc = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsc);
    return () => document.removeEventListener('fullscreenchange', onFsc);
  }, []);

  // Prevent page scroll while player is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Initialise explicitement le volume au montage (le navigateur peut persister un état muet)
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = 1;
    v.muted = false;
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'Escape' && !document.fullscreenElement) { onClose(); return; }
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); togglePlay(); }
      if (e.key === 'f') toggleFullscreen();
      if (e.key === 'm') toggleMute();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, togglePlay, toggleFullscreen, toggleMute]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (videoRef.current) videoRef.current.currentTime = ratio * duration;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <div
        ref={containerRef}
        className="relative w-full h-full flex items-center justify-center"
        onMouseMove={() => scheduleHide(playing)}
        onMouseLeave={() => playing && setShowControls(false)}
      >
        {/* Video element */}
        <video
          ref={videoRef}
          src={url}
          className="w-full h-full object-contain"
          playsInline
          onPlay={() => { setPlaying(true); scheduleHide(true); }}
          onPause={() => { setPlaying(false); clearTimeout(hideTimer.current); setShowControls(true); }}
          onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
          onDurationChange={() => setDuration(videoRef.current?.duration ?? 0)}
          onWaiting={() => setBuffering(true)}
          onCanPlay={() => setBuffering(false)}
          onLoadedData={() => setBuffering(false)}
          onError={() => setError('Impossible de lire la vidéo. Vérifiez que le NAS est accessible et que le format est supporté par votre navigateur.')}
        />

        {/* Click to play/pause */}
        <div className="absolute inset-0 cursor-pointer" onClick={togglePlay} />

        {/* Centered play button when paused */}
        {!playing && !buffering && !error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="p-5 rounded-full bg-black/50 backdrop-blur-sm">
              <Play className="w-12 h-12 fill-white stroke-none" />
            </div>
          </div>
        )}

        {/* Buffering spinner */}
        {buffering && !error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="p-4 rounded-full bg-black/40 backdrop-blur-sm">
              <Loader2 className="w-10 h-10 text-white animate-spin" />
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center px-8 max-w-md">
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                <X className="w-8 h-8 text-red-400" />
              </div>
              <p className="text-zinc-300 text-sm leading-relaxed">{error}</p>
            </div>
          </div>
        )}

        {/* Controls overlay */}
        <div
          className={`absolute inset-0 flex flex-col justify-between transition-opacity duration-300 pointer-events-none select-none ${showControls ? 'opacity-100' : 'opacity-0'}`}
        >
          {/* Top bar */}
          <div className="bg-gradient-to-b from-black/80 via-black/30 to-transparent px-5 pt-4 pb-16 flex items-center justify-between pointer-events-auto">
            <h2 className="text-white font-semibold text-sm md:text-base truncate mr-4 drop-shadow-lg">{title}</h2>
            <button
              onClick={onClose}
              className="p-2 rounded-full bg-black/50 hover:bg-white/20 text-zinc-300 hover:text-white transition-colors flex-shrink-0 backdrop-blur-sm"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Bottom bar */}
          <div className="bg-gradient-to-t from-black/90 via-black/50 to-transparent px-5 pt-16 pb-5 space-y-3 pointer-events-auto">
            {/* Progress bar */}
            <div
              className="relative h-1 group cursor-pointer rounded-full overflow-visible"
              onClick={handleSeek}
            >
              {/* Track */}
              <div className="absolute inset-0 bg-white/20 rounded-full" />
              {/* Buffered (visual only, approximate) */}
              <div className="absolute left-0 top-0 h-full bg-white/10 rounded-full" style={{ width: `${Math.min(progress + 10, 100)}%` }} />
              {/* Played */}
              <div
                className="absolute left-0 top-0 h-full bg-[#e50914] rounded-full transition-none"
                style={{ width: `${progress}%` }}
              />
              {/* Thumb */}
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity -translate-x-1/2"
                style={{ left: `${progress}%` }}
              />
            </div>

            {/* Buttons row */}
            <div className="flex items-center gap-4">
              {/* Play / Pause */}
              <button
                onClick={togglePlay}
                className="text-white hover:scale-110 transition-transform"
                aria-label={playing ? 'Pause' : 'Lecture'}
              >
                {playing
                  ? <Pause className="w-7 h-7 fill-white stroke-none" />
                  : <Play className="w-7 h-7 fill-white stroke-none" />
                }
              </button>

              {/* Volume */}
              <div className="flex items-center gap-2 group/vol">
                <button onClick={toggleMute} className="text-white hover:scale-110 transition-transform" aria-label="Muet">
                  {muted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>
                <div className="w-0 overflow-hidden group-hover/vol:w-20 transition-all duration-200">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.02}
                    value={muted ? 0 : volume}
                    onChange={(e) => {
                      const v = videoRef.current;
                      if (!v) return;
                      const vol = Number(e.target.value);
                      v.volume = vol;
                      setVolume(vol);
                      v.muted = vol === 0;
                      setMuted(vol === 0);
                    }}
                    className="w-20 h-1 appearance-none bg-white/30 rounded cursor-pointer accent-white"
                  />
                </div>
              </div>

              {/* Time */}
              <span className="text-white/80 text-xs font-mono tabular-nums">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>

              <div className="flex-1" />

              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                className="text-white hover:scale-110 transition-transform"
                aria-label="Plein écran"
              >
                {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
