import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { KEY, useRemoteKeys } from '../hooks/useRemoteKeys';
import { getStreamUrl, getEpisodeStreamUrl, resolveApiUrl } from '../lib/api';
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
  onBack: () => void;
}

// ── Native webOS media player ──────────────────────────────────────────────
// Launches com.webos.app.photovideo via PalmServiceBridge (no SDK required).
// Falls back to webOS SDK if PalmServiceBridge is unavailable.
function launchNativePlayer(url: string, title = ''): boolean {
  const w = window as Window & typeof globalThis & {
    PalmServiceBridge?: new () => {
      onservicecallback: ((msg: string) => void) | null;
      call: (uri: string, params: string) => void;
    };
    webOS?: {
      service?: {
        request: (uri: string, params: object) => void;
      };
    };
  };

  const launchParams = {
    id: 'com.webos.app.photovideo',
    params: {
      contentList: [{ url, type: 'video', title }],
      displayAudioFocus: true,
    },
  };

  // Approach 1: PalmServiceBridge — low-level, always available on webOS, no lib needed
  if (w.PalmServiceBridge) {
    const bridge = new w.PalmServiceBridge();
    bridge.onservicecallback = null;
    bridge.call(
      'luna://com.webos.applicationManager/launch',
      JSON.stringify(launchParams),
    );
    return true;
  }

  // Approach 2: webOS SDK (webOSTV.js)
  if (w.webOS?.service?.request) {
    w.webOS.service.request('luna://com.webos.applicationManager/launch', {
      parameters: launchParams,
      onSuccess: () => {},
      onFailure: () => {},
    });
    return true;
  }

  return false;
}

// ── Helpers ────────────────────────────────────────────────────────────────

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
  const key = code.toLowerCase().replace(/-.*/, '');
  return LANG_LABELS[key] || code.toUpperCase();
}

function mediaErrorMessage(code: number): string {
  switch (code) {
    case 1: return 'Lecture abandonnée';
    case 2: return 'Erreur réseau';
    case 3: return 'Erreur de décodage (codec non supporté ?)';
    case 4: return 'Format/codec non supporté par le navigateur TV';
    default: return 'Erreur inconnue';
  }
}

// Détecte webOS de façon synchrone (PalmServiceBridge est injecté par le runtime webOS)
function isWebOS(): boolean {
  return typeof (window as Window & typeof globalThis & { PalmServiceBridge?: unknown }).PalmServiceBridge !== 'undefined';
}

// ── Composant webOS : lance le lecteur natif, pas de <video> ──────────────

function NativePlayerScreen({ url, title, onBack }: { url: string; title?: string; onBack: () => void }) {
  const [launched, setLaunched] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ok = launchNativePlayer(url, title ?? '');
    if (ok) setLaunched(true);
    else setFailed(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRemoteKeys((e) => {
    if (e.keyCode === KEY.BACK || e.keyCode === KEY.STOP) {
      e.preventDefault();
      onBack();
    }
  }, [onBack]);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#09090b',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: '1rem',
    }}>
      {failed ? (
        <>
          <span style={{ fontSize: '2rem' }}>⚠️</span>
          <span style={{ color: '#e50914', fontSize: '0.9rem', fontWeight: 700 }}>
            Lecteur natif non disponible
          </span>
          <button onClick={onBack} style={backBtnStyle}>← Retour</button>
        </>
      ) : (
        <>
          <div style={{
            width: '4rem', height: '4rem', borderRadius: '50%',
            background: 'rgba(74,222,128,0.12)', border: '2px solid rgba(74,222,128,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.8rem',
          }}>
            {launched ? '▶' : '…'}
          </div>
          {title && (
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', maxWidth: '70%', textAlign: 'center' }}>
              {title}
            </div>
          )}
          <div style={{ fontSize: '0.75rem', color: '#4ade80', fontWeight: 600 }}>
            {launched ? 'Lecture dans le lecteur TV' : 'Lancement…'}
          </div>
          <div style={{ fontSize: '0.55rem', color: 'rgba(255,255,255,0.3)', marginTop: '0.25rem' }}>
            Appuyez sur BACK pour revenir à Nasflix
          </div>
          <button onClick={onBack} style={{ ...backBtnStyle, marginTop: '2rem' }}>← Retour</button>
        </>
      )}
    </div>
  );
}

const backBtnStyle: React.CSSProperties = {
  padding: '0.6rem 2rem',
  background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: '8px', color: '#fff', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
};

// ── Component ──────────────────────────────────────────────────────────────

export default function VideoPlayer({ url: rawUrl, isHls, durationSeconds, title, tracks, mediaId, episodeId, onBack }: Props) {
  const url = resolveApiUrl(rawUrl);

  // Sur webOS : déléguer directement au lecteur natif, sans monter <video>
  if (isWebOS()) {
    return <NativePlayerScreen url={url} title={title} onBack={onBack} />;
  }
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const saveTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seekHintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [seekHint, setSeekHint] = useState<string | null>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const [activeAudio, setActiveAudio] = useState(0);

  const [seekMode, setSeekMode] = useState(false);
  const [pendingSeekTime, setPendingSeekTime] = useState<number | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);

  // Native player state (manual green-key trigger only, for non-webOS)
  const [nativeUnavailable, setNativeUnavailable] = useState(false);

  // Resume prompt
  const savedProgress = watchProgress.get(mediaId, episodeId);
  const [showResume, setShowResume] = useState(!!savedProgress && savedProgress.currentTime > 10);
  const [resumeCountdown, setResumeCountdown] = useState(8);

  // HLS audio tracks (from manifest)
  const [hlsAudioTracks, setHlsAudioTracks] = useState<Array<{ id: number; name: string; lang: string }>>([]);
  // Native audio tracks (from video.audioTracks on non-HLS)
  const [nativeAudioTracks, setNativeAudioTracks] = useState<Array<{ index: number; title: string; language: string; codec: string; channels: number }>>([]);

  const showControlsFor = useCallback((ms = 4000) => {
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

  // ── Native audio tracks (non-HLS) ────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isHls) return;

    const readNativeTracks = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const at = (video as any).audioTracks as { length: number; [i: number]: { enabled: boolean; language?: string; label?: string } } | undefined;
      if (at && at.length > 0) {
        const parsed: typeof nativeAudioTracks = [];
        for (let i = 0; i < at.length; i++) {
          const t = at[i];
          const lang = t.language || '';
          const lname = langName(lang);
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
    };
  }, [url, isHls]);

  // ── HLS / video init ─────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setHlsAudioTracks([]);
    setNativeAudioTracks([]);
    setVideoError(null);

    const onError = () => {
      const err = video.error;
      const msg = err ? `Code ${err.code}: ${err.message || mediaErrorMessage(err.code)}` : 'Erreur inconnue';
      setVideoError(msg);
    };
    video.addEventListener('error', onError);

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, maxBufferLength: 30 });
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!savedProgress || savedProgress.currentTime <= 10) {
          video.play().catch(() => {});
        }
      });
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
        setHlsAudioTracks(data.audioTracks.map((t) => ({
          id: t.id,
          name: t.name || t.lang || `Piste ${t.id + 1}`,
          lang: t.lang || '',
        })));
      });
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
        setActiveAudio(data.id);
      });
    } else {
      video.src = url;
      if (!savedProgress || savedProgress.currentTime <= 10) {
        video.play().catch(() => {});
      }
    }
    return () => {
      video.removeEventListener('error', onError);
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, isHls]);

  // ── Time updates ─────────────────────────────────────────────────────
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

  // ── Auto-save progress every 15s ────────────────────────────────────
  useEffect(() => {
    saveTimer.current = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.paused) return;
      const dur = video.duration || durationSeconds || 0;
      watchProgress.save(mediaId, episodeId, video.currentTime, dur);
    }, 15_000);
    return () => clearInterval(saveTimer.current);
  }, [mediaId, episodeId, durationSeconds]);

  // ── Resume countdown ─────────────────────────────────────────────────
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

  // ── Save on unmount ──────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      const video = videoRef.current;
      if (!video) return;
      const dur = video.duration || durationSeconds || 0;
      watchProgress.save(mediaId, episodeId, video.currentTime, dur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Audio track switching ────────────────────────────────────────────
  const applyAudioTrack = async (index: number) => {
    const video = videoRef.current;
    if (!video) return;
    setMenuOpen(false);
    showControlsFor();

    if (isHls && hlsRef.current) {
      if (hlsAudioTracks.length > 1) {
        hlsRef.current.audioTrack = index;
      } else {
        const savedTime = video.currentTime;
        try {
          const newStream = episodeId
            ? await getEpisodeStreamUrl(episodeId, index + 1)
            : await getStreamUrl(mediaId, index + 1);
          hlsRef.current.destroy();
          const hls = new Hls({ enableWorker: true, maxBufferLength: 30 });
          hlsRef.current = hls;
          hls.loadSource(newStream.url);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.currentTime = savedTime;
            video.play().catch(() => {});
          });
          hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
            setHlsAudioTracks(data.audioTracks.map((t) => ({
              id: t.id, name: t.name || t.lang || `Piste ${t.id + 1}`, lang: t.lang || '',
            })));
          });
          setActiveAudio(index);
        } catch { /* ignore */ }
      }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const at = (video as any).audioTracks as { length: number; [i: number]: { enabled: boolean } } | undefined;
      if (at && at.length > 0) for (let i = 0; i < at.length; i++) at[i].enabled = (i === index);
      setActiveAudio(index);
    }
  };

  // ── Native player launch (manual trigger, non-webOS fallback) ───────
  const doLaunchNative = useCallback(() => {
    const launched = launchNativePlayer(url, title ?? '');
    if (!launched) setNativeUnavailable(true);
  }, [url, title]);

  // ── Derived state ─────────────────────────────────────────────────────
  const effectiveAudioTracks = isHls && hlsAudioTracks.length > 0
    ? hlsAudioTracks.map((t) => ({ index: t.id, title: t.name, language: t.lang, codec: '', channels: 0 }))
    : nativeAudioTracks.length > 0
      ? nativeAudioTracks
      : (tracks?.audio ?? []);

  const hasTracks = effectiveAudioTracks.length > 0;
  const hasMenu = effectiveAudioTracks.length > 1;
  const activeAudioTrack = effectiveAudioTracks[activeAudio];

  const duration = durationSeconds || videoRef.current?.duration || 0;
  const displayTime = pendingSeekTime ?? currentTime;
  const progress = duration > 0 ? (displayTime / duration) * 100 : 0;

  // ── Remote keys ──────────────────────────────────────────────────────
  useRemoteKeys((e) => {
    const video = videoRef.current;
    if (!video) return;

    if (showResume) {
      e.preventDefault();
      if (e.keyCode === KEY.OK || e.keyCode === KEY.PLAY) doResume();
      else if (e.keyCode === KEY.BACK) onBack();
      else doStartOver();
      return;
    }

    if (menuOpen) {
      e.preventDefault();
      if (e.keyCode === KEY.BACK) { setMenuOpen(false); showControlsFor(); }
      else if (e.keyCode === KEY.UP) setMenuIndex((i) => Math.max(0, i - 1));
      else if (e.keyCode === KEY.DOWN) setMenuIndex((i) => Math.min(effectiveAudioTracks.length - 1, i + 1));
      else if (e.keyCode === KEY.OK) {
        const item = effectiveAudioTracks[menuIndex];
        if (item) applyAudioTrack(item.index);
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
      if (hasMenu) { setMenuIndex(activeAudio); setMenuOpen(true); clearTimeout(hideTimer.current); setShowControls(true); }
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
    } else if (e.keyCode === KEY.GREEN) {
      e.preventDefault();
      doLaunchNative();
    }
  }, [onBack, menuOpen, menuIndex, effectiveAudioTracks, activeAudio, hasMenu, seekMode, pendingSeekTime, durationSeconds, showResume, mediaId, episodeId, showControlsFor, doLaunchNative]);

  const DEBUG = import.meta.env.VITE_DEBUG === 'true';

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
      <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'contain' }} playsInline />

      {/* ── Error overlay ──────────────────────────────────────────────── */}
      {videoError && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: '0.75rem',
          background: 'rgba(0,0,0,0.9)',
        }}>
          <span style={{ fontSize: '2rem' }}>⚠️</span>
          <span style={{ color: '#e50914', fontSize: '1rem', fontWeight: 700 }}>Erreur de lecture</span>
          <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.75rem', maxWidth: '65%', textAlign: 'center' }}>
            {videoError}
          </span>

          {/* Native player CTA (desktop fallback only — webOS uses NativePlayerScreen) */}
          <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
            {nativeUnavailable ? (
              <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.7rem' }}>
                Lecteur natif non disponible sur cet appareil
              </span>
            ) : (
              <>
                <button
                  onClick={doLaunchNative}
                  style={{
                    padding: '0.75rem 2rem',
                    background: '#4ade80', border: 'none', borderRadius: '8px',
                    color: '#000', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  ▶ Ouvrir dans le lecteur TV
                </button>
                <span style={{ fontSize: '0.55rem', color: 'rgba(255,255,255,0.25)' }}>
                  Touche verte de la télécommande
                </span>
              </>
            )}
          </div>

          <button
            onClick={onBack}
            style={{
              marginTop: '0.25rem', padding: '0.5rem 1.5rem',
              background: '#e50914', border: 'none', borderRadius: '6px',
              color: '#fff', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
            }}
          >
            ← Retour
          </button>
        </div>
      )}

      {/* ── Debug panel ────────────────────────────────────────────────── */}
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
          <div style={{ marginBottom: '6px', color: 'rgba(255,255,255,0.4)' }}>HLS ({hlsAudioTracks.length}):</div>
          {hlsAudioTracks.length === 0
            ? <div style={{ color: '#f87171', marginBottom: '6px' }}>— aucune piste HLS</div>
            : hlsAudioTracks.map((t) => (
              <div key={t.id} style={{ color: t.id === activeAudio ? '#4ade80' : '#fff', marginBottom: '2px' }}>
                {t.id === activeAudio ? '▶' : ' '} [{t.id}] {t.name} ({t.lang})
              </div>
            ))
          }
          <div style={{ marginTop: '6px', marginBottom: '4px', color: 'rgba(255,255,255,0.4)' }}>Native ({nativeAudioTracks.length}):</div>
          {nativeAudioTracks.length === 0
            ? <div style={{ color: '#fbbf24', marginBottom: '6px' }}>— aucune piste native</div>
            : nativeAudioTracks.map((t) => (
              <div key={t.index} style={{ color: t.index === activeAudio ? '#4ade80' : '#fff', marginBottom: '2px' }}>
                {t.index === activeAudio ? '▶' : ' '} [{t.index}] {t.title} ({t.language})
              </div>
            ))
          }
          <div style={{ marginTop: '6px', marginBottom: '4px', color: 'rgba(255,255,255,0.4)' }}>
            Backend ({tracks?.audio?.length ?? '—'}):
          </div>
          {!tracks
            ? <div style={{ color: '#f87171' }}>— API non chargée</div>
            : tracks.audio.map((t) => (
              <div key={t.index} style={{ color: '#fff', marginBottom: '2px' }}>
                [{t.index}] {t.title} ({t.language}) {t.codec} {t.channels}ch
              </div>
            ))
          }
        </div>
      )}

      {/* ── Resume prompt ──────────────────────────────────────────────── */}
      {showResume && savedProgress && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'rgba(14,14,18,0.97)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '16px', padding: '2rem 2.5rem', textAlign: 'center', maxWidth: '480px',
          }}>
            <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Reprendre la lecture
            </div>
            {title && <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>{title}</div>}
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--red)', marginBottom: '1.2rem' }}>
              {formatTime(savedProgress.currentTime)}
              <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', marginLeft: '0.5rem', fontWeight: 400 }}>/ {formatTime(savedProgress.duration)}</span>
            </div>
            <div style={{ display: 'flex', gap: '0.8rem', justifyContent: 'center', marginBottom: '1rem' }}>
              <button style={resumeBtn(true)} onClick={doResume}>▶ Reprendre</button>
              <button style={resumeBtn(false)} onClick={doStartOver}>↺ Recommencer</button>
            </div>
            <div style={{ fontSize: '0.5rem', color: 'rgba(255,255,255,0.25)' }}>
              OK reprendre · autre touche recommencer · auto dans {resumeCountdown}s
            </div>
          </div>
        </div>
      )}

      {/* ── Seek hint ──────────────────────────────────────────────────── */}
      {seekHint && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          background: 'rgba(0,0,0,0.82)', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '12px', padding: '0.7rem 1.6rem',
          fontSize: '1.8rem', fontWeight: 700, color: '#fff', pointerEvents: 'none',
        }}>
          {seekHint}
        </div>
      )}

      {/* ── Audio track menu ───────────────────────────────────────────── */}
      {menuOpen && effectiveAudioTracks.length > 0 && (
        <div style={{
          position: 'absolute', bottom: '9rem', left: '3rem',
          background: 'rgba(8,8,10,0.96)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '14px', padding: '1.1rem', minWidth: '300px', maxWidth: '400px',
        }}>
          <div style={{
            fontSize: '0.65rem', fontWeight: 700, color: 'rgba(255,255,255,0.5)',
            textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem',
          }}>
            🔊 Pistes audio
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {effectiveAudioTracks.map((item, i) => {
              const isActive = i === activeAudio;
              const isFocused = i === menuIndex;
              return (
                <div key={item.index} style={{
                  display: 'flex', alignItems: 'center', gap: '0.7rem',
                  padding: '0.6rem 0.8rem', borderRadius: '8px',
                  background: isFocused ? 'rgba(229,9,20,0.2)' : (isActive ? 'rgba(255,255,255,0.05)' : 'transparent'),
                  border: `2px solid ${isFocused ? 'rgba(229,9,20,0.5)' : 'transparent'}`,
                }}>
                  <span style={{ fontSize: '0.6rem', color: isActive ? 'var(--red)' : 'rgba(255,255,255,0.15)', flexShrink: 0 }}>●</span>
                  <span style={{ flex: 1, fontSize: '0.75rem', color: isFocused ? '#fff' : 'rgba(255,255,255,0.65)' }}>
                    {item.title}
                    {item.language && langName(item.language) !== item.title && (
                      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.6rem', marginLeft: '0.35rem' }}>
                        {langName(item.language)}
                      </span>
                    )}
                    {(item.codec || item.channels > 0) && (
                      <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.6rem', marginLeft: '0.4rem' }}>
                        {[item.codec, item.channels > 0 ? channelLabel(item.channels) : ''].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: '0.7rem', fontSize: '0.5rem', color: 'rgba(255,255,255,0.2)', textAlign: 'center' }}>
            ↑↓ naviguer · OK confirmer · BACK fermer
          </div>
        </div>
      )}

      {/* ── Controls overlay ───────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', inset: 0,
        opacity: showControls ? 1 : 0,
        transition: 'opacity 0.3s',
        pointerEvents: 'none',
      }}>
        {title && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            padding: '2rem 3rem 4rem',
            background: 'linear-gradient(rgba(0,0,0,0.75), transparent)',
          }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff' }}>{title}</div>
          </div>
        )}

        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '2.5rem 3rem 2rem',
          background: 'linear-gradient(transparent, rgba(0,0,0,0.9) 35%)',
        }}>
          {/* Active audio track + native player hint */}
          {hasTracks && (
            <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.75rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.45rem', color: 'rgba(255,255,255,0.25)' }}>
                {hasMenu ? '↑ Pistes :' : 'Piste :'}
              </span>
              <span style={{
                fontSize: '0.45rem', padding: '0.18rem 0.55rem', borderRadius: '4px',
                background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff',
                display: 'flex', alignItems: 'center', gap: '0.3rem',
              }}>
                🔊 {activeAudioTrack?.title || 'Audio'}
                {activeAudioTrack?.language && (
                  <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.38rem', borderLeft: '1px solid rgba(255,255,255,0.18)', paddingLeft: '0.3rem' }}>
                    {langName(activeAudioTrack.language)}
                  </span>
                )}
                {activeAudioTrack && activeAudioTrack.channels > 0 && (
                  <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.38rem' }}>
                    {activeAudioTrack.codec ? `${activeAudioTrack.codec} · ` : ''}{channelLabel(activeAudioTrack.channels)}
                  </span>
                )}
              </span>
              <span style={{
                fontSize: '0.45rem', padding: '0.18rem 0.55rem', borderRadius: '4px',
                background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.15)',
                color: 'rgba(74,222,128,0.6)',
              }}>
                🟢 Lecteur TV
              </span>
            </div>
          )}

          {/* Timeline */}
          <div style={{
            height: '5px', background: 'rgba(255,255,255,0.18)', borderRadius: '3px',
            marginBottom: '1.2rem', position: 'relative',
            outline: seekMode ? '2px solid var(--red)' : 'none', outlineOffset: '5px',
          }}>
            <div style={{
              height: '100%', width: `${progress}%`,
              background: seekMode ? '#fff' : 'var(--red)', borderRadius: '3px',
              transition: seekMode ? 'none' : 'width 0.5s linear',
            }} />
            <div style={{
              position: 'absolute', top: '50%', left: `${progress}%`,
              transform: 'translate(-50%, -50%)',
              width: seekMode ? '18px' : '12px', height: seekMode ? '18px' : '12px',
              borderRadius: '50%', background: '#fff',
              boxShadow: seekMode ? '0 0 0 3px var(--red)' : '0 0 0 2px var(--red)',
              transition: seekMode ? 'none' : 'left 0.5s linear, width 0.15s, height 0.15s',
              willChange: 'left',
            }} />
          </div>

          {/* Controls row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.2rem' }}>
              <div style={{
                width: '2.8rem', height: '2.8rem', borderRadius: '50%', background: 'var(--red)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.2rem', lineHeight: 1, flexShrink: 0,
              }}>
                {playing ? '⏸' : '▶'}
              </div>
              <span style={{ fontSize: '1.1rem', fontWeight: 600, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
                {formatTime(displayTime)}
                <span style={{ color: 'rgba(255,255,255,0.35)', fontWeight: 400 }}> / {formatTime(duration)}</span>
              </span>
            </div>
            <div style={{ display: 'flex', gap: '1.2rem', alignItems: 'center' }}>
              {seekMode ? (
                <span style={{ fontSize: '0.6rem', color: 'var(--red)', fontWeight: 700 }}>
                  ⬤ SEEK — ←→ ±30s · OK valider · BACK annuler
                </span>
              ) : (
                <>
                  <span style={{ fontSize: '0.5rem', color: 'rgba(255,255,255,0.3)' }}>←→ ±10s</span>
                  <span style={{ fontSize: '0.5rem', color: 'rgba(255,255,255,0.3)' }}>⏮⏭ ±30s</span>
                  <span style={{ fontSize: '0.5rem', color: 'rgba(255,255,255,0.3)' }}>↓ Seek{hasMenu ? ' · ↑ Audio' : ''}</span>
                  <span style={{ fontSize: '0.5rem', color: 'rgba(74,222,128,0.5)' }}>🟢 Lecteur TV</span>
                  <span style={{ fontSize: '0.5rem', color: 'rgba(255,255,255,0.3)' }}>BACK quitter</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function resumeBtn(primary: boolean): React.CSSProperties {
  return {
    padding: '0.6rem 1.4rem',
    background: primary ? 'var(--red)' : 'rgba(255,255,255,0.08)',
    border: `1px solid ${primary ? 'var(--red)' : 'rgba(255,255,255,0.12)'}`,
    borderRadius: '8px', color: '#fff',
    fontSize: '0.65rem', fontWeight: 700, cursor: 'pointer',
  };
}
