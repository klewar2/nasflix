import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Hls from 'hls.js';
import { Headphones, Loader2, Maximize, Minimize, Pause, Play, Subtitles, Volume2, VolumeX, X } from 'lucide-react';
import { api } from '@/lib/api-client';

interface VideoPlayerModalProps {
  url: string;
  title: string;
  onClose: () => void;
  isHls?: boolean;
  durationSeconds?: number;
  mediaId?: number;
  episodeId?: number;
  sourceType?: 'NAS' | 'SEEDBOX';
  jellyfinItemId?: string;
  jellyfinBaseUrl?: string;
  jellyfinApiToken?: string;
}

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function resolveUrl(url: string, seek = 0): string {
  const base = url.startsWith('/') ? `${API_BASE}${url}` : url;
  if (seek > 0 && url.includes('/nas/transcode')) return `${base}&seek=${seek}`;
  return base;
}

function buildJellyfinUrlWithAudio(masterUrl: string, audioStreamIndex: number): string {
  try {
    const u = new URL(masterUrl);
    u.searchParams.set('AudioStreamIndex', String(audioStreamIndex));
    return u.toString();
  } catch {
    return masterUrl;
  }
}

export function VideoPlayerModal({
  url,
  title,
  onClose,
  isHls = false,
  durationSeconds = 0,
  mediaId,
  episodeId,
  sourceType,
  jellyfinItemId,
  jellyfinBaseUrl,
  jellyfinApiToken,
}: VideoPlayerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hlsRef = useRef<Hls | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [seekOffset, setSeekOffset] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [buffering, setBuffering] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeAudio, setActiveAudio] = useState(0);
  const [activeSubtitle, setActiveSubtitle] = useState(-1);
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [showSubMenu, setShowSubMenu] = useState(false);

  const totalDuration = durationSeconds > 0 ? durationSeconds : (videoDuration > 0 && isFinite(videoDuration) ? videoDuration : 0);
  const absoluteTime = seekOffset + currentTime;
  const progress = totalDuration > 0 ? Math.min((absoluteTime / totalDuration) * 100, 100) : 0;

  // Load tracks
  const tracksEnabled = !!(mediaId || episodeId);
  const { data: tracks } = useQuery({
    queryKey: ['tracks', mediaId ?? episodeId, !!episodeId],
    queryFn: () => episodeId ? api.getEpisodeTracks(episodeId!) : api.getMediaTracks(mediaId!),
    enabled: tracksEnabled,
    staleTime: Infinity,
  });

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

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-audio-menu]')) setShowAudioMenu(false);
      if (!t.closest('[data-sub-menu]')) setShowSubMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // HLS initialisation
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !isHls) return;

    const fullHlsUrl = resolveUrl(url);
    const token = localStorage.getItem('accessToken');

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        xhrSetup: (xhr) => { if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`); },
      });
      hlsRef.current = hls;
      hls.loadSource(fullHlsUrl);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { v.volume = 1; v.muted = false; });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) setError('Impossible de lire la vidéo. Vérifiez que la source est accessible.');
      });
      return () => { hls.destroy(); hlsRef.current = null; };
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = fullHlsUrl;
      v.volume = 1;
      v.muted = false;
    }
  }, [url, isHls]);

  // Init volume for non-HLS
  useEffect(() => {
    if (isHls) return;
    const v = videoRef.current;
    if (v) { v.volume = 1; v.muted = false; }
  }, [isHls]);

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

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (totalDuration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seekTo = Math.floor(ratio * totalDuration);

    const v = videoRef.current;
    if (!v) return;

    if (url.includes('/nas/transcode')) {
      setSeekOffset(seekTo);
      setCurrentTime(0);
      setBuffering(true);
      setPlaying(false);
      v.src = resolveUrl(url, seekTo);
      v.play().catch(() => {});
    } else {
      v.currentTime = ratio * (videoDuration || totalDuration);
    }
  };

  const handleAudioTrackChange = (trackIndex: number) => {
    setActiveAudio(trackIndex);
    setShowAudioMenu(false);
    const hls = hlsRef.current;
    const v = videoRef.current;
    if (!hls || !v) return;

    if (sourceType === 'SEEDBOX' && jellyfinBaseUrl && jellyfinApiToken && jellyfinItemId) {
      // Jellyfin: rebuild URL with AudioStreamIndex and reload hls
      const newUrl = buildJellyfinUrlWithAudio(resolveUrl(url), trackIndex);
      const token = localStorage.getItem('accessToken');
      hls.destroy();
      const newHls = new Hls({
        enableWorker: true,
        xhrSetup: (xhr) => { if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`); },
      });
      hlsRef.current = newHls;
      newHls.loadSource(newUrl);
      newHls.attachMedia(v);
      newHls.on(Hls.Events.MANIFEST_PARSED, () => { v.play().catch(() => {}); });
    } else {
      // Native HLS multi-track
      if (hls.audioTracks && hls.audioTracks.length > trackIndex) {
        hls.audioTrack = trackIndex;
      }
    }
  };

  const handleSubtitleChange = (trackIndex: number) => {
    setActiveSubtitle(trackIndex);
    setShowSubMenu(false);
    const v = videoRef.current;
    if (!v) return;
    for (let i = 0; i < v.textTracks.length; i++) {
      v.textTracks[i].mode = i === trackIndex ? 'showing' : 'disabled';
    }
  };

  const audioTracks = tracks?.audio ?? [];
  const subtitleTracks = tracks?.subtitles ?? [];
  const activeAudioLabel = audioTracks[activeAudio]?.language?.slice(0, 2).toUpperCase() ?? null;

  const videoSrc = isHls ? undefined : resolveUrl(url, 0);

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
          src={videoSrc}
          className="w-full h-full object-contain"
          playsInline
          onPlay={() => { setPlaying(true); scheduleHide(true); }}
          onPause={() => { setPlaying(false); clearTimeout(hideTimer.current); setShowControls(true); }}
          onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
          onDurationChange={() => setVideoDuration(videoRef.current?.duration ?? 0)}
          onWaiting={() => setBuffering(true)}
          onCanPlay={() => setBuffering(false)}
          onLoadedData={() => setBuffering(false)}
          onError={() => setError('Impossible de lire la vidéo. Vérifiez que la source est accessible et que le format est supporté.')}
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
              <div className="absolute inset-0 bg-white/20 rounded-full" />
              <div
                className="absolute left-0 top-0 h-full bg-[#e50914] rounded-full transition-none"
                style={{ width: `${progress}%` }}
              />
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
                {formatTime(absoluteTime)} / {totalDuration > 0 ? formatTime(totalDuration) : '--:--'}
              </span>

              <div className="flex-1" />

              {/* Audio track selector */}
              {audioTracks.length > 1 && (
                <div className="relative" data-audio-menu>
                  <button
                    onClick={() => { setShowAudioMenu(v => !v); setShowSubMenu(false); }}
                    className="flex items-center gap-1 text-white hover:scale-110 transition-transform"
                    aria-label="Pistes audio"
                  >
                    <Headphones className="w-5 h-5" />
                    {activeAudioLabel && <span className="text-xs font-medium">{activeAudioLabel}</span>}
                  </button>
                  {showAudioMenu && (
                    <div className="absolute bottom-8 right-0 bg-zinc-900/95 border border-zinc-700 rounded-lg py-1 min-w-[160px] shadow-xl">
                      {audioTracks.map((track, i) => (
                        <button
                          key={i}
                          onClick={() => handleAudioTrackChange(i)}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-zinc-700 transition-colors ${activeAudio === i ? 'text-[#e50914] font-medium' : 'text-zinc-200'}`}
                        >
                          {track.title} {track.codec ? `(${track.codec})` : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Subtitle selector */}
              {subtitleTracks.length > 0 && (
                <div className="relative" data-sub-menu>
                  <button
                    onClick={() => { setShowSubMenu(v => !v); setShowAudioMenu(false); }}
                    className={`flex items-center gap-1 hover:scale-110 transition-transform ${activeSubtitle >= 0 ? 'text-[#e50914]' : 'text-white'}`}
                    aria-label="Sous-titres"
                  >
                    <Subtitles className="w-5 h-5" />
                  </button>
                  {showSubMenu && (
                    <div className="absolute bottom-8 right-0 bg-zinc-900/95 border border-zinc-700 rounded-lg py-1 min-w-[160px] shadow-xl">
                      <button
                        onClick={() => handleSubtitleChange(-1)}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-zinc-700 transition-colors ${activeSubtitle === -1 ? 'text-[#e50914] font-medium' : 'text-zinc-200'}`}
                      >
                        Désactivés
                      </button>
                      {subtitleTracks.map((track, i) => (
                        <button
                          key={i}
                          onClick={() => handleSubtitleChange(i)}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-zinc-700 transition-colors ${activeSubtitle === i ? 'text-[#e50914] font-medium' : 'text-zinc-200'}`}
                        >
                          {track.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

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
