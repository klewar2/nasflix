import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { KEY, useRemoteKeys } from '../hooks/useRemoteKeys';
import { getStreamUrl, getEpisodeStreamUrl } from '../lib/api';
import type { MediaTracks } from '../lib/api';
import { watchProgress } from '../lib/progress';

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
  videoQuality?: string;
  hdr?: boolean;
  onBack: () => void;
  onNextEpisode?: () => void;
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
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

const LANG_LABELS: Record<string, string> = {
  fra: 'Français', fre: 'Français', fr: 'Français',
  eng: 'English', en: 'English',
  deu: 'Deutsch', ger: 'Deutsch', de: 'Deutsch',
  spa: 'Español', es: 'Español',
  ita: 'Italiano', it: 'Italiano',
  jpn: '日本語', ja: '日本語',
  kor: '한국어', ko: '한국어',
  por: 'Português', pt: 'Português',
  und: 'Indéfini',
};

function langName(code: string): string {
  if (!code) return '';
  const key = code.toLowerCase().replace(/-.*/, ''); // strip region (e.g. fr-FR → fr)
  return LANG_LABELS[key] || code.toUpperCase();
}

// Jellyfin transcodes the first segment on-demand; startLevel=0 avoids ABR
// killing that slow segment, and the long timeouts keep hls.js from giving up.
const HLS_CONFIG = {
  enableWorker: true,
  maxBufferLength: 30,
  fragLoadingTimeOut: 120_000,
  manifestLoadingTimeOut: 30_000,
  levelLoadingTimeOut: 30_000,
  fragLoadingMaxRetry: 6,
  fragLoadingRetryDelay: 2000,
  startLevel: 0,
} as const;

type TrackSection = 'audio' | 'subtitle';

export default function VideoPlayer({ url, isHls, durationSeconds, title, tracks, mediaId, episodeId, sourceType, videoQuality, hdr, onBack, onNextEpisode }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const saveTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seekHintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [seekHint, setSeekHint] = useState<string | null>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuSection, setMenuSection] = useState<TrackSection>('audio');
  const [menuIndex, setMenuIndex] = useState(0);
  const [activeAudio, setActiveAudio] = useState(0);
  const [activeSubtitle, setActiveSubtitle] = useState(-1);

  const [seekMode, setSeekMode] = useState(false);
  const [pendingSeekTime, setPendingSeekTime] = useState<number | null>(null);
  const [videoError, setVideoError] = useState<{ code: number; message: string } | null>(null);
  const [nextEpCountdown, setNextEpCountdown] = useState<number | null>(null);
  const nextEpTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [isBuffering, setIsBuffering] = useState(true);

  const DEBUG = import.meta.env.VITE_DEBUG === 'true';
  const VERBOSE = import.meta.env.VITE_PLAYER_VERBOSE === 'true' || DEBUG;
  const dlog = (msg: string) => {
    if (DEBUG) setDebugLogs((l) => [...l.slice(-30), `${new Date().toISOString().slice(11, 23)} ${msg}`]);
    console.log('[VideoPlayer]', msg);
  };
  /** Logs toujours visibles dans la console TV (adb / devtools) — utile au diagnostic sans VITE_DEBUG */
  const tvLog = (msg: string, extra?: Record<string, string | number | boolean | undefined>) => {
    const tail = extra ? ` ${JSON.stringify(extra)}` : '';
    console.info(`[NasflixTV] ${msg}${tail}`);
  };

  // Resume prompt: shown at start if saved progress exists
  const savedProgress = watchProgress.get(mediaId, episodeId);
  const [showResume, setShowResume] = useState(!!savedProgress && savedProgress.currentTime > 10);
  const [resumeCountdown, setResumeCountdown] = useState(8);

  const showControlsFor = useCallback((ms = 6000) => {
    setShowControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setShowControls(false);
      setSeekMode(false);
      setPendingSeekTime(null);
    }, ms);
  }, []);

  const showSeekHint = (text: string) => {
    setSeekHint(text);
    clearTimeout(seekHintTimer.current);
    seekHintTimer.current = setTimeout(() => setSeekHint(null), 1200);
  };

  // HLS audio tracks detected from manifest
  const [hlsAudioTracks, setHlsAudioTracks] = useState<Array<{ id: number; name: string; lang: string }>>([]);
  // Native audio tracks (non-HLS, read from video.audioTracks on loadedmetadata)
  const [nativeAudioTracks, setNativeAudioTracks] = useState<Array<{ index: number; title: string; language: string; codec: string; channels: number }>>([]);
  // Native subtitle tracks (read from video.textTracks on loadedmetadata)
  const [nativeSubtitleTracks, setNativeSubtitleTracks] = useState<Array<{ index: number; title: string; language: string; codec: string }>>([]);

  // ── Native audio tracks (non-HLS, e.g. FileStation direct stream) ─────
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isHls) return;

    const readNativeTracks = () => {
      // ── Audio tracks ──
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const at = (video as any).audioTracks as { length: number; [i: number]: { enabled: boolean; language?: string; label?: string; id?: string } } | undefined;
      if (at && at.length > 0) {
        const parsed: Array<{ index: number; title: string; language: string; codec: string; channels: number }> = [];
        for (let i = 0; i < at.length; i++) {
          const t = at[i];
          const lang = t.language || '';
          const lname = langName(lang);
          // Use label if it's meaningful (not just a number or a raw lang code)
          const label = (t.label && t.label !== lang && !/^\d+$/.test(t.label))
            ? t.label
            : lname || `Piste ${i + 1}`;
          parsed.push({ index: i, title: label, language: lang, codec: '', channels: 0 });
        }
        setNativeAudioTracks(parsed);
        for (let i = 0; i < at.length; i++) {
          if (at[i].enabled) { setActiveAudio(i); break; }
        }
      } else {
        setNativeAudioTracks([]);
      }

      // ── Subtitle tracks ──
      const tt = video.textTracks;
      if (tt && tt.length > 0) {
        const parsed: Array<{ index: number; title: string; language: string; codec: string }> = [];
        for (let i = 0; i < tt.length; i++) {
          const t = tt[i];
          if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
          const lang = t.language || '';
          const lname = langName(lang);
          const label = (t.label && t.label !== lang) ? t.label : lname || `Sous-titre ${parsed.length + 1}`;
          parsed.push({ index: i, language: lang, title: label, codec: '' });
        }
        setNativeSubtitleTracks(parsed);
      } else {
        setNativeSubtitleTracks([]);
      }
    };

    video.addEventListener('loadedmetadata', readNativeTracks);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const at = (video as any).audioTracks;
    if (at) at.onchange = readNativeTracks;

    return () => {
      video.removeEventListener('loadedmetadata', readNativeTracks);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const atClean = (video as any).audioTracks;
      if (atClean) atClean.onchange = null;
      setNativeAudioTracks([]);
      setNativeSubtitleTracks([]);
    };
  }, [url, isHls]);

  // ── HLS / video init ───────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setHlsAudioTracks([]);
    setNativeAudioTracks([]);
    setVideoError(null);
    setIsBuffering(true);
    tvLog('player init', {
      mediaId,
      episodeId: episodeId ?? undefined,
      isHls,
      streamUrlChars: url.length,
      streamUrlStart: url.slice(0, 96),
    });
    dlog(`init — isHls=${isHls} url=${url.slice(0, 80)}…`);

    const onError = () => {
      const err = video.error;
      if (err) {
        const info = { code: err.code, message: err.message || '' };
        setVideoError(info);
        setIsBuffering(false);
        tvLog('video element error', {
          mediaId,
          episodeId: episodeId ?? undefined,
          code: err.code,
          message: err.message || '',
          networkState: video.networkState,
          readyState: video.readyState,
        });
        dlog(`video.error code=${err.code} msg="${err.message}" networkState=${video.networkState} readyState=${video.readyState}`);
      }
    };
    let loggedFirstBuffer = false;
    const onWaiting = () => { setIsBuffering(true); if (VERBOSE) tvLog('waiting (buffer)', { mediaId }); };
    const onStalled = () => { setIsBuffering(true); if (VERBOSE) tvLog('stalled', { mediaId }); };
    const onCanPlay = () => setIsBuffering(false);
    const onPlayingEv = () => setIsBuffering(false);
    const onSeeking = () => setIsBuffering(true);
    const onSeeked = () => setIsBuffering(false);
    const onProgress = () => {
      if (!VERBOSE || loggedFirstBuffer || video.buffered.length === 0) return;
      const end = video.buffered.end(video.buffered.length - 1);
      if (end > 0.2) {
        loggedFirstBuffer = true;
        tvLog('first buffer ok', { mediaId, bufferedEndSec: Math.round(end * 10) / 10 });
      }
    };
    video.addEventListener('error', onError);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('stalled', onStalled);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('playing', onPlayingEv);
    video.addEventListener('seeking', onSeeking);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('progress', onProgress);

    if (isHls && Hls.isSupported()) {
      dlog('HLS mode — Hls.isSupported=true');
      const hls = new Hls(HLS_CONFIG);
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        dlog('HLS MANIFEST_PARSED');
        if (!savedProgress || savedProgress.currentTime <= 10) {
          video.play().catch((e) => dlog(`play() rejected: ${e}`));
        } else {
          video.pause();
        }
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        tvLog('hls error', {
          mediaId,
          fatal: data.fatal,
          type: data.type,
          details: String(data.details),
        });
        dlog(`HLS error fatal=${data.fatal} type=${data.type} details=${data.details}`);
      });
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
        dlog(`HLS AUDIO_TRACKS_UPDATED count=${data.audioTracks.length}`);
        setHlsAudioTracks(data.audioTracks.map((t) => ({
          id: t.id,
          name: t.name || t.lang || `Piste ${t.id + 1}`,
          lang: t.lang || '',
        })));
      });
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
        dlog(`HLS AUDIO_TRACK_SWITCHED id=${data.id}`);
        setActiveAudio(data.id);
      });
    } else {
      dlog(`native video mode — isHls=${isHls} HlsSupported=${Hls.isSupported()}`);
      video.src = url;
      if (!savedProgress || savedProgress.currentTime <= 10) {
        video.play().catch((e) => dlog(`play() rejected: ${e}`));
      }
    }
    return () => {
      video.removeEventListener('error', onError);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('stalled', onStalled);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('playing', onPlayingEv);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('progress', onProgress);
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, isHls]);

  // ── Time updates ───────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    let lastUpdate = 0;
    const onTime = () => {
      const now = Date.now();
      if (now - lastUpdate > 500) {
        lastUpdate = now;
        setCurrentTime(video.currentTime);
      }
    };
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTime);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTime);
    };
  }, []);

  // ── Auto-hide controls après 6s quand la lecture est active ──────────
  useEffect(() => {
    if (!playing || showResume || menuOpen || seekMode) return;
    showControlsFor(6000);
  }, [playing, showResume, menuOpen, seekMode, showControlsFor]);

  // ── Épisode suivant: déclenche le compte à rebours à 90% de progression ──
  useEffect(() => {
    if (!onNextEpisode || nextEpCountdown !== null) return;
    const dur = durationSeconds || videoRef.current?.duration || 0;
    if (!dur || !playing) return;
    if (currentTime / dur < 0.9) return;
    // Start countdown
    setNextEpCountdown(15);
    nextEpTimer.current = setInterval(() => {
      setNextEpCountdown((c) => {
        if (c === null || c <= 1) {
          clearInterval(nextEpTimer.current);
          onNextEpisode();
          return null;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(nextEpTimer.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, playing, durationSeconds, onNextEpisode]);

  // ── Auto-save progress every 15s ─────────────────────────────────────
  useEffect(() => {
    saveTimer.current = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.paused) return;
      const dur = video.duration || durationSeconds || 0;
      watchProgress.save(mediaId, episodeId, video.currentTime, dur);
    }, 15_000);
    return () => clearInterval(saveTimer.current);
  }, [mediaId, episodeId, durationSeconds]);

  // ── Resume prompt countdown ───────────────────────────────────────────
  useEffect(() => {
    if (!showResume) return;
    const interval = setInterval(() => {
      setResumeCountdown((c) => {
        if (c <= 1) {
          clearInterval(interval);
          setShowResume(false);
          videoRef.current?.play().catch(() => {});
          showControlsFor();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    resumeTimer.current = undefined;
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showResume]);

  const doResume = () => {
    const video = videoRef.current;
    if (!video || !savedProgress) return;
    video.currentTime = savedProgress.currentTime;
    setCurrentTime(savedProgress.currentTime);
    setShowResume(false);
    video.play().catch(() => {});
    showControlsFor();
  };

  const doStartOver = () => {
    const video = videoRef.current;
    if (!video) return;
    watchProgress.clear(mediaId, episodeId);
    setShowResume(false);
    video.currentTime = 0;
    video.play().catch(() => {});
    showControlsFor();
  };

  // ── Save on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      const video = videoRef.current;
      if (!video) return;
      const dur = video.duration || durationSeconds || 0;
      watchProgress.save(mediaId, episodeId, video.currentTime, dur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyAudioTrackHls = async (index: number) => {
    const video = videoRef.current;
    if (!video) return;
    setMenuOpen(false);
    showControlsFor();

    if (isHls && hlsRef.current) {
      if (hlsAudioTracks.length > 1) {
        // Manifest has multiple tracks → switch via hls.js (no stream reload)
        hlsRef.current.audioTrack = index;
      } else if (sourceType === 'SEEDBOX') {
        // Jellyfin: rebuild URL with AudioStreamIndex=N
        const savedTime = video.currentTime;
        try {
          const newUrl = (() => {
            try {
              const u = new URL(url);
              u.searchParams.set('AudioStreamIndex', String(index));
              return u.toString();
            } catch { return url; }
          })();
          hlsRef.current.destroy();
          const hls = new Hls(HLS_CONFIG);
          hlsRef.current = hls;
          hls.loadSource(newUrl);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.currentTime = savedTime;
            video.play().catch(() => {});
          });
          setActiveAudio(index);
        } catch { /* ignore */ }
      } else {
        // Single track in manifest → re-request stream with different audio track
        // VideoStation audio tracks are 1-indexed
        const savedTime = video.currentTime;
        try {
          const newStream = episodeId
            ? await getEpisodeStreamUrl(episodeId, index + 1)
            : await getStreamUrl(mediaId, index + 1);
          hlsRef.current.destroy();
          const hls = new Hls(HLS_CONFIG);
          hlsRef.current = hls;
          hls.loadSource(newStream.url);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.currentTime = savedTime;
            video.play().catch(() => {});
          });
          hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
            setHlsAudioTracks(data.audioTracks.map((t) => ({
              id: t.id,
              name: t.name || t.lang || `Piste ${t.id + 1}`,
              lang: t.lang || '',
            })));
          });
          setActiveAudio(index);
        } catch { /* ignore */ }
      }
    } else {
      // Non-HLS: native audioTracks API
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const at = (video as any).audioTracks as { length: number; [i: number]: { enabled: boolean } } | undefined;
      if (at && at.length > 0) for (let i = 0; i < at.length; i++) at[i].enabled = (i === index);
      setActiveAudio(index);
    }
  };

  const applySubtitle = (index: number) => {
    const video = videoRef.current;
    if (!video) return;
    const tt = video.textTracks;
    for (let i = 0; i < tt.length; i++) tt[i].mode = (i === index) ? 'showing' : 'disabled';
    setActiveSubtitle(index);
  };

  // For HLS: prefer hls.js-detected tracks; for non-HLS: native audioTracks API, fallback to backend
  const effectiveAudioTracks = isHls && hlsAudioTracks.length > 0
    ? hlsAudioTracks.map((t) => ({ index: t.id, title: t.name, language: t.lang, codec: '', channels: 0 }))
    : nativeAudioTracks.length > 0
      ? nativeAudioTracks
      : (tracks?.audio ?? []);
  const effectiveSubtitles = nativeSubtitleTracks.length > 0
    ? nativeSubtitleTracks
    : (tracks?.subtitles ?? []);

  const currentItems = menuSection === 'audio'
    ? effectiveAudioTracks
    : [{ index: -1, title: 'Désactivés', language: '', codec: '' }, ...effectiveSubtitles];

  // Show track bar when there's at least 1 audio track; show picker when there are multiple or subtitles exist
  const hasTracks = effectiveAudioTracks.length > 0;
  const hasMenu = effectiveAudioTracks.length > 1 || effectiveSubtitles.length > 0;

  const duration = durationSeconds || videoRef.current?.duration || 0;
  const displayTime = pendingSeekTime ?? currentTime;
  const progress = duration > 0 ? (displayTime / duration) * 100 : 0;

  // ── Remote keys ────────────────────────────────────────────────────────
  useRemoteKeys((e) => {
    const video = videoRef.current;
    if (!video) return;

    // Next episode countdown: OK = go now, BACK = dismiss
    if (nextEpCountdown !== null) {
      e.preventDefault();
      if (e.keyCode === KEY.OK) {
        clearInterval(nextEpTimer.current);
        setNextEpCountdown(null);
        onNextEpisode?.();
      } else if (e.keyCode === KEY.BACK) {
        clearInterval(nextEpTimer.current);
        setNextEpCountdown(null);
      }
      return;
    }

    // Resume prompt: OK = resume, anything else = start over
    if (showResume) {
      e.preventDefault();
      if (e.keyCode === KEY.OK || e.keyCode === KEY.PLAY) {
        doResume();
      } else if (e.keyCode === KEY.BACK) {
        onBack();
      } else {
        doStartOver();
      }
      return;
    }

    if (menuOpen) {
      e.preventDefault();
      if (e.keyCode === KEY.BACK) { setMenuOpen(false); showControlsFor(); }
      else if (e.keyCode === KEY.UP) setMenuIndex((i) => Math.max(0, i - 1));
      else if (e.keyCode === KEY.DOWN) setMenuIndex((i) => Math.min(currentItems.length - 1, i + 1));
      else if (e.keyCode === KEY.LEFT) { setMenuSection('audio'); setMenuIndex(0); }
      else if (e.keyCode === KEY.RIGHT) { setMenuSection('subtitle'); setMenuIndex(0); }
      else if (e.keyCode === KEY.OK) {
        const item = currentItems[menuIndex];
        if (!item) return;
        if (menuSection === 'audio') applyAudioTrackHls(item.index as number);
        else { applySubtitle(item.index as number); setMenuOpen(false); showControlsFor(); }
      }
      return;
    }

    if (seekMode) {
      e.preventDefault();
      const dur = video.duration || durationSeconds || 0;
      const base = pendingSeekTime ?? video.currentTime;
      if (e.keyCode === KEY.LEFT) {
        const next = Math.max(base - 30, 0);
        setPendingSeekTime(next); showSeekHint(`→ ${formatTime(next)}`); showControlsFor(8000);
      } else if (e.keyCode === KEY.RIGHT) {
        const next = Math.min(base + 30, dur);
        setPendingSeekTime(next); showSeekHint(`→ ${formatTime(next)}`); showControlsFor(8000);
      } else if (e.keyCode === KEY.FF) {
        const next = Math.min(base + 60, dur);
        setPendingSeekTime(next); showSeekHint(`→ ${formatTime(next)}`); showControlsFor(8000);
      } else if (e.keyCode === KEY.RW) {
        const next = Math.max(base - 60, 0);
        setPendingSeekTime(next); showSeekHint(`→ ${formatTime(next)}`); showControlsFor(8000);
      } else if (e.keyCode === KEY.OK) {
        if (pendingSeekTime !== null) { video.currentTime = pendingSeekTime; setCurrentTime(pendingSeekTime); }
        setPendingSeekTime(null); setSeekMode(false); showControlsFor();
      } else if (e.keyCode === KEY.BACK || e.keyCode === KEY.UP) {
        setPendingSeekTime(null); setSeekMode(false); showControlsFor();
      }
      return;
    }

    showControlsFor();

    if (e.keyCode === KEY.BACK) {
      e.preventDefault();
      const dur = video.duration || durationSeconds || 0;
      watchProgress.save(mediaId, episodeId, video.currentTime, dur);
      onBack();
    } else if (e.keyCode === KEY.UP) {
      e.preventDefault();
      if (hasMenu) { setMenuSection('audio'); setMenuIndex(activeAudio); setMenuOpen(true); clearTimeout(hideTimer.current); setShowControls(true); }
    } else if (e.keyCode === KEY.DOWN) {
      e.preventDefault();
      setPendingSeekTime(video.currentTime); setSeekMode(true); showControlsFor(8000);
    } else if (e.keyCode === KEY.OK || e.keyCode === KEY.PLAY_PAUSE || e.keyCode === KEY.PLAY || e.keyCode === KEY.PAUSE) {
      e.preventDefault();
      if (video.paused) video.play(); else video.pause();
    } else if (e.keyCode === KEY.FF) {
      e.preventDefault();
      const t = Math.min(video.currentTime + 30, video.duration || 0);
      video.currentTime = t; setCurrentTime(t); showSeekHint('+30s');
    } else if (e.keyCode === KEY.RW) {
      e.preventDefault();
      const t = Math.max(video.currentTime - 10, 0);
      video.currentTime = t; setCurrentTime(t); showSeekHint('−10s');
    } else if (e.keyCode === KEY.RIGHT) {
      e.preventDefault();
      const t = Math.min(video.currentTime + 10, video.duration || 0);
      video.currentTime = t; setCurrentTime(t); showSeekHint('+10s');
    } else if (e.keyCode === KEY.LEFT) {
      e.preventDefault();
      const t = Math.max(video.currentTime - 10, 0);
      video.currentTime = t; setCurrentTime(t); showSeekHint('−10s');
    } else if (e.keyCode === KEY.STOP) {
      e.preventDefault();
      const dur = video.duration || durationSeconds || 0;
      watchProgress.save(mediaId, episodeId, video.currentTime, dur);
      onBack();
    }
  }, [onBack, menuOpen, menuSection, menuIndex, currentItems, activeAudio, tracks, hasMenu, seekMode, pendingSeekTime, durationSeconds, showResume, mediaId, episodeId, showControlsFor, nextEpCountdown, onNextEpisode]);

  const audioSummary = (() => {
    const t = effectiveAudioTracks[activeAudio];
    if (!t) return 'Audio';
    const lang = langName(t.language) || t.title;
    const ch = t.channels > 0 ? ` · ${channelLabel(t.channels)}` : '';
    return `${lang}${ch}`;
  })();

  const subSummary = (() => {
    if (activeSubtitle < 0) return 'Désactivés';
    const t = effectiveSubtitles[activeSubtitle];
    return t ? (langName(t.language) || t.title) : 'Désactivés';
  })();

  const clockTime = (() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  })();

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
      <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'contain' }} playsInline />

      {/* ── Buffering loader ─────────────────────────────────────────── */}
      {isBuffering && !videoError && !showResume && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: '0.625rem', pointerEvents: 'none',
          background: 'rgba(0,0,0,0.35)',
        }}>
          <div style={{
            width: '2rem', height: '2rem',
            border: '2px solid rgba(255,255,255,0.1)',
            borderTop: '2px solid var(--accent)',
            borderRadius: '50%',
            animation: 'nasflix-spin 0.8s linear infinite',
          }} />
          <span style={{ color: 'rgba(255,255,255,0.6)', fontFamily: 'var(--mono)', fontSize: '0.34rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            BUFFER…
          </span>
          <style>{`@keyframes nasflix-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* ── Debug panel (audio tracks) ──────────────────────────────── */}
      {DEBUG && (
        <div style={{
          position: 'absolute', top: '12px', left: '12px', zIndex: 9999,
          background: 'rgba(0,0,0,0.92)', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: '8px', padding: '10px 14px', fontFamily: 'monospace',
          fontSize: '11px', minWidth: '320px', maxWidth: '420px', pointerEvents: 'none',
        }}>
          <div style={{ color: '#e50914', fontWeight: 700, marginBottom: '6px' }}>🎵 DEBUG TRACKS</div>
          <div style={{ marginBottom: '4px', color: 'rgba(255,255,255,0.5)' }}>
            isHls: <span style={{ color: '#fff' }}>{String(isHls)}</span>
            {' '}| hasTracks: <span style={{ color: hasTracks ? '#4ade80' : '#f87171' }}>{String(hasTracks)}</span>
            {' '}| hasMenu: <span style={{ color: hasMenu ? '#4ade80' : '#f87171' }}>{String(hasMenu)}</span>
          </div>
          <div style={{ marginBottom: '6px', color: 'rgba(255,255,255,0.4)' }}>
            HLS audioTracks ({hlsAudioTracks.length}):
          </div>
          {hlsAudioTracks.length === 0
            ? <div style={{ color: '#f87171', marginBottom: '6px' }}>— aucune piste HLS détectée</div>
            : hlsAudioTracks.map((t) => (
              <div key={t.id} style={{ color: t.id === activeAudio ? '#4ade80' : '#fff', marginBottom: '2px' }}>
                {t.id === activeAudio ? '▶' : ' '} [{t.id}] {t.name} ({t.lang})
              </div>
            ))
          }
          <div style={{ marginTop: '6px', marginBottom: '4px', color: 'rgba(255,255,255,0.4)' }}>
            nativeSubs ({nativeSubtitleTracks.length}): {nativeSubtitleTracks.map((t) => `[${t.index}]${t.title}`).join(', ') || '—'}
          </div>
          <div style={{ marginTop: '4px', marginBottom: '4px', color: 'rgba(255,255,255,0.4)' }}>
            Native audioTracks ({nativeAudioTracks.length}):
          </div>
          {nativeAudioTracks.length === 0
            ? <div style={{ color: '#fbbf24', marginBottom: '6px' }}>— aucune piste native détectée</div>
            : nativeAudioTracks.map((t) => (
              <div key={t.index} style={{ color: t.index === activeAudio ? '#4ade80' : '#fff', marginBottom: '2px' }}>
                {t.index === activeAudio ? '▶' : ' '} [{t.index}] {t.title} ({t.language})
              </div>
            ))
          }
          <div style={{ marginTop: '6px', marginBottom: '4px', color: 'rgba(255,255,255,0.4)' }}>
            Backend tracks ({tracks?.audio?.length ?? 'undefined'}):
          </div>
          {!tracks
            ? <div style={{ color: '#f87171' }}>— API tracks non chargées</div>
            : tracks.audio.length === 0
              ? <div style={{ color: '#fbbf24' }}>— API retourne 0 pistes audio</div>
              : tracks.audio.map((t) => (
                <div key={t.index} style={{ color: '#fff', marginBottom: '2px' }}>
                  [{t.index}] {t.title} ({t.language}) {t.codec} {t.channels}ch
                </div>
              ))
          }
        </div>
      )}

      {/* ── Resume prompt ───────────────────────────────────────────── */}
      {showResume && savedProgress && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'rgba(14,14,18,0.88)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid var(--line-strong)',
            borderRadius: '0.5rem',
            padding: '1.25rem 1.5rem',
            textAlign: 'center',
            maxWidth: '17.5rem',
          }}>
            <div className="uppercase-eyebrow" style={{ marginBottom: '0.4375rem' }}>
              Reprendre la lecture ?
            </div>
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
              }} onClick={doResume}>
                <svg width="10" height="10" viewBox="0 0 12 12"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor"/></svg>
                Reprendre
              </button>
              <button style={{
                background: 'rgba(255,255,255,0.08)', color: '#fff',
                border: '1px solid var(--line-strong)',
                padding: '0.375rem 0.6875rem', borderRadius: '4px',
                fontSize: '0.44rem', cursor: 'pointer',
              }} onClick={doStartOver}>
                ↻ Recommencer
              </button>
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '0.3125rem', color: 'var(--text-dim)', letterSpacing: '0.1em' }}>
              REPRISE AUTOMATIQUE DANS {resumeCountdown} SEC.
            </div>
          </div>
        </div>
      )}

      {/* Seek hint (center of screen, brief) */}
      {seekHint && !seekMode && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          background: 'rgba(0,0,0,0.75)', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '0.5rem', padding: '0.4375rem 1rem',
          fontFamily: 'var(--mono)', fontSize: '1.125rem', fontWeight: 700,
          color: '#fff', pointerEvents: 'none', letterSpacing: '0.06em',
        }}>
          {seekHint}
        </div>
      )}

      {/* Next episode countdown */}
      {nextEpCountdown !== null && onNextEpisode && (
        <div style={{
          position: 'absolute', bottom: '13rem', right: '2rem',
          background: 'rgba(9,9,11,0.92)',
          backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '0.5rem', padding: '0.75rem 1rem',
          display: 'flex', flexDirection: 'column', gap: '0.5rem',
          minWidth: '9rem', zIndex: 50,
        }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '0.3rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Épisode suivant dans {nextEpCountdown}s
          </div>
          <div style={{ display: 'flex', gap: '0.375rem' }}>
            <button
              onClick={() => { clearInterval(nextEpTimer.current); setNextEpCountdown(null); onNextEpisode(); }}
              style={{
                flex: 1, padding: '0.375rem 0.5rem',
                background: '#fff', color: '#0a0a0e',
                border: 'none', borderRadius: '4px',
                fontSize: '0.38rem', fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '0.25rem', justifyContent: 'center',
              }}
            >
              <svg width="9" height="9" viewBox="0 0 12 12"><path d="M2 1.5v9l8-4.5z M11 1.5v9" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/></svg>
              Suivant
            </button>
            <button
              onClick={() => { clearInterval(nextEpTimer.current); setNextEpCountdown(null); }}
              style={{
                padding: '0.375rem 0.5rem',
                background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '4px', color: '#fff', fontSize: '0.38rem', cursor: 'pointer',
              }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* ── Controls overlay ──────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', inset: 0,
        opacity: showControls ? 1 : 0,
        transition: 'opacity 0.3s',
        pointerEvents: showControls ? 'auto' : 'none',
      }}>
        {/* ── TOP BAR ── */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          padding: '0.875rem 2rem',
          display: 'flex', alignItems: 'center', gap: '0.5625rem',
          background: 'linear-gradient(180deg, rgba(0,0,0,0.8) 0%, transparent 100%)',
          pointerEvents: 'none',
        }}>
          <button
            onClick={onBack}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.3125rem',
              padding: '0.25rem 0.4375rem',
              background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '4px', color: '#fff', cursor: 'pointer',
              pointerEvents: 'auto',
            }}
          >
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
            {clockTime}
          </span>
        </div>

        {/* ── BOTTOM PANEL ── */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          background: 'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.65) 30%, rgba(0,0,0,0.97) 100%)',
          padding: '3.75rem 2rem 1rem',
        }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '0.1875rem', marginBottom: '0.875rem', alignItems: 'center' }}>
            {[
              { id: 'play' as const, label: 'Lecture', sub: null, active: !menuOpen },
              { id: 'audio' as const, label: 'Audio', sub: audioSummary, active: menuOpen && menuSection === 'audio' },
              { id: 'subtitle' as const, label: 'Sous-titres', sub: subSummary, active: menuOpen && menuSection === 'subtitle' },
            ].map((tab) => (
              <div
                key={tab.id}
                onClick={() => {
                  if (tab.id === 'play') { setMenuOpen(false); showControlsFor(); }
                  else { setMenuSection(tab.id as TrackSection); setMenuIndex(0); setMenuOpen(true); clearTimeout(hideTimer.current); }
                }}
                style={{
                  padding: '0.3125rem 0.5625rem',
                  borderRadius: '4px',
                  background: tab.active ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${tab.active ? 'rgba(255,255,255,0.25)' : 'var(--line-strong)'}`,
                  display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '3.75rem',
                  cursor: 'pointer',
                  outline: tab.active ? '3px solid rgba(255,255,255,0.5)' : 'none',
                  outlineOffset: '3px',
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
              {seekMode ? '◀▶ ±30s · OK valider · BACK annuler' : '↑ Pistes · ↓ Scrub · ←→ ±10s'}
            </span>
          </div>

          {/* Track list (when menu open) */}
          {menuOpen && (
            <div style={{
              marginBottom: '0.875rem',
              maxHeight: '7.5rem', overflowY: 'auto',
              display: 'flex', flexDirection: 'column', gap: '2px',
            }}>
              {currentItems.map((item, i) => {
                const isActive = menuSection === 'audio' ? (i === activeAudio) : (item.index === activeSubtitle);
                const isFocused = i === menuIndex;
                const audioItem = menuSection === 'audio'
                  ? (item as { index: number; title: string; codec: string; channels: number; language: string })
                  : null;
                return (
                  <div key={item.index} style={{
                    display: 'flex', alignItems: 'center', gap: '0.4375rem',
                    padding: '0.4375rem 0.5rem', borderRadius: '4px',
                    background: isFocused
                      ? 'var(--accent-soft)'
                      : isActive ? 'rgba(255,255,255,0.04)' : 'transparent',
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
                      {audioItem && (audioItem.codec || audioItem.channels > 0) && (
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '0.3rem', color: 'var(--text-dim)', marginTop: '1px' }}>
                          {[audioItem.codec, audioItem.channels > 0 ? channelLabel(audioItem.channels) : ''].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </div>
                    {isActive && <span className="chip accent" style={{ fontSize: '0.28rem' }}>ACTIF</span>}
                  </div>
                );
              })}
              {currentItems.length === 0 && (
                <span style={{ fontFamily: 'var(--mono)', fontSize: '0.38rem', color: 'var(--text-dim)', padding: '0.25rem 0.5rem' }}>
                  Aucune piste disponible
                </span>
              )}
            </div>
          )}

          {/* Timeline */}
          <div style={{ position: 'relative', marginBottom: '0.875rem' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '0.5rem' }}>
              <span style={{
                fontFamily: 'var(--mono)', fontSize: '1.75rem', color: '#fff',
                fontWeight: 500, letterSpacing: '0.02em', fontVariantNumeric: 'tabular-nums',
              }}>
                {formatTime(displayTime)}
              </span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '0.4375rem', color: 'rgba(255,255,255,0.4)', marginLeft: '0.375rem' }}>
                / {formatTime(duration)}
              </span>
              <div style={{ flex: 1 }} />
              {seekMode && (
                <span style={{
                  display: 'flex', alignItems: 'center', gap: '0.3125rem',
                  padding: '0.1875rem 0.4375rem',
                  background: 'var(--accent-soft)', border: '1px solid var(--accent-line)',
                  borderRadius: '4px',
                }}>
                  <span style={{ width: '0.25rem', height: '0.25rem', borderRadius: '50%', background: 'var(--accent)', animation: 'pulse-soft 2s ease-in-out infinite' }} />
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '0.375rem', color: '#e8b3ad', letterSpacing: '0.08em' }}>
                    SCRUB
                  </span>
                </span>
              )}
              <span style={{ fontFamily: 'var(--mono)', fontSize: '0.375rem', color: 'rgba(255,255,255,0.5)', marginLeft: '0.5625rem' }}>
                −{formatTime(Math.max(0, duration - displayTime))} restantes
              </span>
            </div>

            {/* Progress bar */}
            <div style={{ position: 'relative', height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.15)', overflow: 'visible' }}>
              {/* Played */}
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress}%`,
                background: seekMode ? '#fff' : 'var(--accent)', borderRadius: '3px',
                transition: seekMode ? 'none' : 'width 0.5s linear',
              }} />
              {/* Thumb */}
              <div style={{
                position: 'absolute', left: `${progress}%`, top: '50%',
                transform: 'translate(-50%, -50%)',
                width: seekMode ? '1.375rem' : '1rem', height: seekMode ? '1.375rem' : '1rem',
                borderRadius: '50%', background: '#fff',
                boxShadow: seekMode
                  ? '0 0 0 5px var(--accent), 0 0 24px rgba(177,58,48,0.6)'
                  : '0 0 0 3px var(--accent)',
                transition: seekMode ? 'none' : 'left 0.5s linear',
                willChange: 'left',
              }} />
              {/* Scrub preview thumbnail (placeholder) */}
              {seekMode && (
                <div style={{
                  position: 'absolute', left: `${progress}%`, bottom: '1.125rem',
                  transform: 'translateX(-50%)',
                  width: '7.5rem', height: '4.21875rem',
                  borderRadius: '4px', overflow: 'hidden',
                  border: '2px solid #fff',
                  boxShadow: '0 10px 40px rgba(0,0,0,0.8)',
                  background: 'linear-gradient(135deg, #1a1a22, #0a0a0e)',
                  display: 'flex', alignItems: 'flex-end', padding: '0.1875rem 0.25rem',
                }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '0.3rem', color: '#fff', background: 'rgba(0,0,0,0.7)', padding: '1px 4px', borderRadius: '2px' }}>
                    {formatTime(displayTime)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Transport row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {/* Round transport buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4375rem' }}>
              {/* Prev */}
              <RoundBtn size={46}>
                <svg width="13" height="13" viewBox="0 0 13 13"><path d="M10 1.5v10l-8-5z M2 1.5v10" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/></svg>
              </RoundBtn>
              {/* −10s */}
              <RoundBtn size={46} sub="−10">
                <svg width="14" height="14" viewBox="0 0 14 14"><path d="M12 7a5 5 0 1 1-5-5V0L3.5 3.5 7 7" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </RoundBtn>
              {/* Play/Pause — big */}
              <RoundBtn size={64} big onClick={() => { const v = videoRef.current; if (!v) return; v.paused ? v.play() : v.pause(); }}>
                {playing
                  ? <svg width="18" height="18" viewBox="0 0 18 18"><rect x="2" y="2" width="5" height="14" rx="1" fill="currentColor"/><rect x="11" y="2" width="5" height="14" rx="1" fill="currentColor"/></svg>
                  : <svg width="18" height="18" viewBox="0 0 18 18"><path d="M4 2v14l12-7z" fill="currentColor"/></svg>
                }
              </RoundBtn>
              {/* +10s */}
              <RoundBtn size={46} sub="+10">
                <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 7a5 5 0 1 0 5-5V0L10.5 3.5 7 7" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </RoundBtn>
              {/* Next */}
              <RoundBtn size={46}>
                <svg width="13" height="13" viewBox="0 0 13 13"><path d="M3 1.5v10l8-5z M11 1.5v10" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/></svg>
              </RoundBtn>
            </div>

            <div style={{ flex: 1 }} />

            {/* Track summary chips */}
            {hasTracks && (
              <div style={{ display: 'flex', gap: '0.375rem' }}>
                <span className="chip" style={{ fontSize: '0.34rem' }}>
                  🔊 {audioSummary}
                </span>
                <span className="chip" style={{ fontSize: '0.34rem', color: activeSubtitle >= 0 ? 'var(--text)' : 'var(--text-dim)' }}>
                  💬 {subSummary}
                </span>
              </div>
            )}

            {/* Next episode button */}
            {onNextEpisode && (
              <button
                onClick={() => { clearInterval(nextEpTimer.current); onNextEpisode(); }}
                style={{
                  background: 'rgba(255,255,255,0.06)', color: '#fff',
                  border: '1px solid var(--line-strong)', borderRadius: '4px',
                  padding: '0.3125rem 0.5625rem', fontSize: '0.41rem', fontWeight: 500,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '0.25rem',
                }}
              >
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
          <button onClick={onBack} style={{ marginTop: '0.5rem', padding: '0.5rem 1.5rem', background: '#e50914', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}>
            ← Retour
          </button>
        </div>
      )}

      {/* ── Debug overlay (VITE_DEBUG=true) ─────────────────────────── */}
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
          <div style={{ color: 'rgba(255,255,255,0.6)', marginBottom: '4px' }}>
            isHls: <span style={{ color: '#fff' }}>{String(isHls)}</span>
            {' '}| readyState: <span style={{ color: '#fff' }}>{videoRef.current?.readyState ?? '?'}</span>
            {' '}| networkState: <span style={{ color: '#fff' }}>{videoRef.current?.networkState ?? '?'}</span>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.6)', marginBottom: '4px' }}>
            hlsAudio: <span style={{ color: '#4ade80' }}>{hlsAudioTracks.length}</span>
            {' '}| nativeAudio: <span style={{ color: '#4ade80' }}>{nativeAudioTracks.length}</span>
            {' '}| backendAudio: <span style={{ color: '#4ade80' }}>{tracks?.audio?.length ?? '—'}</span>
          </div>
          {videoError && (
            <div style={{ color: '#f87171', marginBottom: '4px' }}>
              ERROR code={videoError.code} msg="{videoError.message}"
            </div>
          )}
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

function RoundBtn({ size, big, sub, onClick, children }: {
  size: number; big?: boolean; sub?: string;
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
        transition: 'transform 0.1s, background 0.15s',
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
