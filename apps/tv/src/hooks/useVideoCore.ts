import { useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import Hls from 'hls.js';
import { HLS_CONFIG } from './utils';
import type { WatchProgress } from '../lib/progress';

export type HlsAudioTrack = { id: number; name: string; lang: string };

interface Params {
  url: string;
  isHls: boolean;
  mediaId: number;
  episodeId: number | undefined;
  durationSeconds: number;
  savedProgress: WatchProgress | null;
}

interface Return {
  videoRef: RefObject<HTMLVideoElement | null>;
  hlsRef: MutableRefObject<Hls | null>;
  playing: boolean;
  currentTime: number;
  isBuffering: boolean;
  videoError: { code: number; message: string } | null;
  hlsAudioTracks: HlsAudioTrack[];
  setHlsAudioTracks: Dispatch<SetStateAction<HlsAudioTrack[]>>;
  activeAudio: number;
  setActiveAudio: Dispatch<SetStateAction<number>>;
  urlChangeKey: number;
  debugLogs: string[];
  dlog: (msg: string) => void;
  tvLog: (msg: string, extra?: Record<string, string | number | boolean | undefined>) => void;
}

export function useVideoCore({ url, isHls, mediaId, episodeId, savedProgress }: Params): Return {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isBuffering, setIsBuffering] = useState(true);
  const [videoError, setVideoError] = useState<{ code: number; message: string } | null>(null);
  const [hlsAudioTracks, setHlsAudioTracks] = useState<HlsAudioTrack[]>([]);
  const [activeAudio, setActiveAudio] = useState(0);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [urlChangeKey, setUrlChangeKey] = useState(0);

  const DEBUG = import.meta.env.VITE_DEBUG === 'true';
  const VERBOSE = import.meta.env.VITE_PLAYER_VERBOSE === 'true' || DEBUG;

  const dlog = (msg: string) => {
    if (DEBUG) setDebugLogs(l => [...l.slice(-30), `${new Date().toISOString().slice(11, 23)} ${msg}`]);
    console.log('[VideoPlayer]', msg);
  };

  const tvLog = (msg: string, extra?: Record<string, string | number | boolean | undefined>) => {
    console.info(`[NasflixTV] ${msg}${extra ? ` ${JSON.stringify(extra)}` : ''}`);
  };

  // ── Time / play state ──────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    let lastUpdate = 0;
    const onTime = () => {
      const now = Date.now();
      if (now - lastUpdate > 500) { lastUpdate = now; setCurrentTime(video.currentTime); }
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

  // ── HLS / video init ───────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setHlsAudioTracks([]);
    setActiveAudio(0);
    setVideoError(null);
    setIsBuffering(true);
    setUrlChangeKey(k => k + 1);
    tvLog('player init', { mediaId, episodeId: episodeId ?? undefined, isHls, streamUrlStart: url.slice(0, 96) });
    dlog(`init — isHls=${isHls} url=${url.slice(0, 80)}…`);

    const onError = () => {
      const err = video.error;
      if (!err) return;
      setVideoError({ code: err.code, message: err.message || '' });
      setIsBuffering(false);
      tvLog('video element error', { mediaId, code: err.code, message: err.message || '', networkState: video.networkState, readyState: video.readyState });
    };
    const onWaiting = () => { setIsBuffering(true); if (VERBOSE) tvLog('waiting (buffer)', { mediaId }); };
    const onStalled = () => { setIsBuffering(true); if (VERBOSE) tvLog('stalled', { mediaId }); };
    const onCanPlay = () => setIsBuffering(false);
    const onPlayingEv = () => setIsBuffering(false);
    const onSeeking = () => setIsBuffering(true);
    const onSeeked = () => setIsBuffering(false);
    let loggedFirstBuffer = false;
    const onProgress = () => {
      if (!VERBOSE || loggedFirstBuffer || video.buffered.length === 0) return;
      const end = video.buffered.end(video.buffered.length - 1);
      if (end > 0.2) { loggedFirstBuffer = true; tvLog('first buffer ok', { mediaId, bufferedEndSec: Math.round(end * 10) / 10 }); }
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
      dlog('HLS mode');
      const hls = new Hls(HLS_CONFIG);
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        dlog('HLS MANIFEST_PARSED');
        if (!savedProgress || savedProgress.currentTime <= 10) video.play().catch(e => dlog(`play() rejected: ${e}`));
        else video.pause();
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        tvLog('hls error', { mediaId, fatal: data.fatal, type: data.type, details: String(data.details) });
      });
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
        dlog(`HLS AUDIO_TRACKS_UPDATED count=${data.audioTracks.length}`);
        setHlsAudioTracks(data.audioTracks.map(t => ({ id: t.id, name: t.name || t.lang || `Piste ${t.id + 1}`, lang: t.lang || '' })));
      });
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
        dlog(`HLS AUDIO_TRACK_SWITCHED id=${data.id}`);
        setActiveAudio(data.id);
      });
    } else {
      dlog(`native video mode — isHls=${isHls} HlsSupported=${Hls.isSupported()}`);
      video.src = url;
      if (!savedProgress || savedProgress.currentTime <= 10) video.play().catch(e => dlog(`play() rejected: ${e}`));
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

  return {
    videoRef, hlsRef, playing, currentTime, isBuffering, videoError,
    hlsAudioTracks, setHlsAudioTracks, activeAudio, setActiveAudio,
    urlChangeKey, debugLogs, dlog, tvLog,
  };
}
