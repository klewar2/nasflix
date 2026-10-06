import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { KEY, useRemoteKeys } from './useRemoteKeys';
import { watchProgress } from '../lib/progress';
import type { WatchProgress } from '../lib/progress';
import { channelLabel, formatTime, langName } from './utils';
import type { AudioTrack, SubtitleTrack, TrackItem, TrackSection } from './utils';

export type NavMode = 'play' | 'transport' | 'seek' | 'menu';

interface Params {
  videoRef: RefObject<HTMLVideoElement | null>;
  playing: boolean;
  currentTime: number;
  durationSeconds: number;
  effectiveAudioTracks: AudioTrack[];
  effectiveSubtitles: SubtitleTrack[];
  activeAudio: number;
  activeSubtitle: number;
  applyAudioTrack: (index: number) => Promise<void>;
  applySubtitle: (index: number) => Promise<void>;
  onBack: () => void;
  onNextEpisode: (() => void) | undefined;
  onPrevEpisode: (() => void) | undefined;
  mediaId: number;
  episodeId: number | undefined;
  showResume: boolean;
  setShowResume: Dispatch<SetStateAction<boolean>>;
  savedProgress: WatchProgress | null;
}

interface Return {
  showControls: boolean;
  navMode: NavMode;
  transportFocus: number;
  seekMode: boolean;
  menuOpen: boolean;
  menuSection: TrackSection;
  menuIndex: number;
  currentItems: TrackItem[];
  seekHint: string | null;
  pendingSeekTime: number | null;
  displayTime: number;
  progress: number;
  duration: number;
  audioSummary: string;
  subSummary: string;
  hasTracks: boolean;
  hasMenu: boolean;
  hasPrevEpisode: boolean;
  hasNextEpisode: boolean;
  clockTime: string;
  doResume: () => void;
  doStartOver: () => void;
  showControlsFor: (ms?: number) => void;
  activateTransportBtn: (idx: number) => void;
  /** Ouvre le menu Audio / Sous-titres sur la piste active (télécommande ou pointeur). */
  openMenu: (section: TrackSection) => void;
  /** Applique la piste d'index `i` de la section ouverte et referme le menu. */
  selectMenuItem: (i: number) => void;
}

export function usePlayerNav({
  videoRef, playing, currentTime, durationSeconds, effectiveAudioTracks, effectiveSubtitles,
  activeAudio, activeSubtitle, applyAudioTrack, applySubtitle,
  onBack, onNextEpisode, onPrevEpisode, mediaId, episodeId, showResume, setShowResume, savedProgress,
}: Params): Return {
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seekHintTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [showControls, setShowControls] = useState(true);
  const [navMode, setNavMode] = useState<NavMode>('play');
  const [transportFocus, setTransportFocus] = useState(2);
  const [pendingSeekTime, setPendingSeekTime] = useState<number | null>(null);
  const [menuSection, setMenuSection] = useState<TrackSection>('audio');
  const [menuIndex, setMenuIndex] = useState(0);
  const [seekHint, setSeekHint] = useState<string | null>(null);

  const showControlsFor = useCallback((ms = 6000) => {
    setShowControls(true);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setShowControls(false);
      setNavMode('play');
      setPendingSeekTime(null);
    }, ms);
  }, []);

  // BACK quand l'overlay est affiché : on le masque tout de suite (annule scrub / menu en cours)
  const hideControls = useCallback(() => {
    clearTimeout(hideTimerRef.current);
    setShowControls(false);
    setNavMode('play');
    setPendingSeekTime(null);
  }, []);

  const showSeekHint = useCallback((text: string) => {
    setSeekHint(text);
    clearTimeout(seekHintTimerRef.current);
    seekHintTimerRef.current = setTimeout(() => setSeekHint(null), 1200);
  }, []);

  // Show controls when resume prompt dismisses (auto-play or user action)
  useEffect(() => {
    if (!showResume) showControlsFor();
  }, [showResume]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-hide controls while playing (not in modal modes)
  useEffect(() => {
    if (!playing || showResume || navMode === 'menu' || navMode === 'seek') return;
    showControlsFor(6000);
  }, [playing, showResume, navMode, showControlsFor]);

  const doResume = useCallback(() => {
    const video = videoRef.current;
    if (!video || !savedProgress) return;
    video.currentTime = savedProgress.currentTime;
    setShowResume(false);
    video.play().catch(() => {});
    showControlsFor();
  }, [videoRef, savedProgress, setShowResume, showControlsFor]);

  const doStartOver = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    watchProgress.clear(mediaId, episodeId);
    setShowResume(false);
    video.currentTime = 0;
    video.play().catch(() => {});
    showControlsFor();
  }, [videoRef, mediaId, episodeId, setShowResume, showControlsFor]);

  const activateTransportBtn = useCallback((idx: number) => {
    const video = videoRef.current;
    if (!video) return;
    switch (idx) {
      case 0:
        if (onPrevEpisode) {
          onPrevEpisode();
        } else {
          video.currentTime = 0;
          showSeekHint('|◀');
        }
        break;
      case 1: {
        const t = Math.max(video.currentTime - 10, 0);
        video.currentTime = t;
        showSeekHint('−10s');
        break;
      }
      case 2:
        video.paused ? video.play().catch(() => {}) : video.pause();
        break;
      case 3: {
        const t = Math.min(video.currentTime + 10, video.duration || 0);
        video.currentTime = t;
        showSeekHint('+10s');
        break;
      }
      case 4:
        onNextEpisode?.();
        break;
    }
  }, [videoRef, showSeekHint, onNextEpisode, onPrevEpisode]);

  const hasPrevEpisode = !!onPrevEpisode;
  const hasNextEpisode = !!onNextEpisode;
  const maxTransportIdx = hasNextEpisode ? 4 : 3;

  const hasTracks = effectiveAudioTracks.length > 0;
  // Le menu (Audio / Sous-titres) doit toujours être ouvrable : le sondage des pistes peut
  // arriver en différé (NAS) et la section Sous-titres reste utile même avec une seule piste audio.
  // Sans ça, DOWN depuis la barre de transport ne fait rien → navigation « bloquée » sur le scrub.
  const hasMenu = true;
  const currentItems: TrackItem[] = menuSection === 'audio'
    ? effectiveAudioTracks
    : [{ index: -1, title: 'Désactivés', language: '', codec: '' }, ...effectiveSubtitles];

  // Position de la piste active dans la liste d'une section (« Désactivés » occupe la 1re ligne des sous-titres)
  const activeMenuIndex = useCallback((section: TrackSection) => (
    section === 'audio' ? Math.max(0, activeAudio) : activeSubtitle + 1
  ), [activeAudio, activeSubtitle]);

  const openMenu = useCallback((section: TrackSection) => {
    setNavMode('menu');
    setMenuSection(section);
    setMenuIndex(activeMenuIndex(section));
    clearTimeout(hideTimerRef.current);
    setShowControls(true);
  }, [activeMenuIndex]);

  const selectMenuItem = useCallback((i: number) => {
    const item = currentItems[i];
    if (!item) return;
    if (menuSection === 'audio') applyAudioTrack(item.index);
    else applySubtitle(item.index);
    setNavMode('transport');
    showControlsFor();
  }, [currentItems, menuSection, applyAudioTrack, applySubtitle, showControlsFor]);

  // Stable ref so the remote key handler is registered once and always reads latest values
  const stateRef = useRef({
    navMode: 'play' as NavMode,
    transportFocus: 2,
    menuSection: 'audio' as TrackSection,
    menuIndex: 0,
    currentItems: [] as TrackItem[],
    pendingSeekTime: null as number | null,
    showControls: true,
    showResume: false,
    activeAudio: 0,
    hasTracks: false,
    hasMenu: false,
    maxTransportIdx: 4,
    durationSeconds: 0,
    mediaId: 0,
    episodeId: undefined as number | undefined,
    onBack: () => {},
    applyAudioTrack: (_: number) => Promise.resolve(),
    applySubtitle: (_: number) => Promise.resolve(),
    doResume: () => {},
    doStartOver: () => {},
    activateTransportBtn: (_: number) => {},
    openMenu: (_: TrackSection) => {},
    selectMenuItem: (_: number) => {},
  });
  // Update synchronously every render (safe: events fire after render)
  stateRef.current = {
    navMode, transportFocus, menuSection, menuIndex, currentItems,
    pendingSeekTime, showControls, showResume, activeAudio, hasTracks, hasMenu, maxTransportIdx,
    durationSeconds, mediaId, episodeId,
    onBack, applyAudioTrack, applySubtitle, doResume, doStartOver, activateTransportBtn, openMenu, selectMenuItem,
  };

  useRemoteKeys((e) => {
    const video = videoRef.current;
    if (!video) return;
    const s = stateRef.current;

    // ── Resume prompt ────────────────────────────────────────────────────
    if (s.showResume) {
      e.preventDefault();
      if (e.keyCode === KEY.OK || e.keyCode === KEY.PLAY) s.doResume();
      else if (e.keyCode === KEY.BACK) s.onBack();
      else s.doStartOver();
      return;
    }

    // ── Menu (pistes audio / sous-titres, sous la barre de transport) ────
    if (s.navMode === 'menu') {
      e.preventDefault();
      if (e.keyCode === KEY.BACK) {
        hideControls();
      } else if (e.keyCode === KEY.UP) {
        // Au-dessus de la 1re piste : retour aux boutons de lecture, placés au-dessus du menu
        if (s.menuIndex <= 0) { setNavMode('transport'); showControlsFor(); }
        else setMenuIndex(i => Math.max(0, i - 1));
      } else if (e.keyCode === KEY.DOWN) {
        setMenuIndex(i => Math.min(s.currentItems.length - 1, i + 1));
      } else if (e.keyCode === KEY.LEFT) {
        s.openMenu('audio');
      } else if (e.keyCode === KEY.RIGHT) {
        s.openMenu('subtitle');
      } else if (e.keyCode === KEY.OK) {
        s.selectMenuItem(s.menuIndex);
      }
      return;
    }

    // ── Seek / scrub ─────────────────────────────────────────────────────
    if (s.navMode === 'seek') {
      e.preventDefault();
      const dur = video.duration || s.durationSeconds || 0;
      const base = s.pendingSeekTime ?? video.currentTime;
      if (e.keyCode === KEY.LEFT) {
        const t = Math.max(base - 30, 0); setPendingSeekTime(t); showSeekHint(`→ ${formatTime(t)}`); showControlsFor(8000);
      } else if (e.keyCode === KEY.RIGHT) {
        const t = Math.min(base + 30, dur); setPendingSeekTime(t); showSeekHint(`→ ${formatTime(t)}`); showControlsFor(8000);
      } else if (e.keyCode === KEY.FF) {
        const t = Math.min(base + 60, dur); setPendingSeekTime(t); showSeekHint(`→ ${formatTime(t)}`); showControlsFor(8000);
      } else if (e.keyCode === KEY.RW) {
        const t = Math.max(base - 60, 0); setPendingSeekTime(t); showSeekHint(`→ ${formatTime(t)}`); showControlsFor(8000);
      } else if (e.keyCode === KEY.OK) {
        if (s.pendingSeekTime !== null) video.currentTime = s.pendingSeekTime;
        setPendingSeekTime(null); setNavMode('transport'); showControlsFor();
      } else if (e.keyCode === KEY.BACK) {
        hideControls();
      } else if (e.keyCode === KEY.DOWN || e.keyCode === KEY.UP) {
        setPendingSeekTime(null); setNavMode('transport'); showControlsFor();
      }
      return;
    }

    // ── Transport buttons ────────────────────────────────────────────────
    if (s.navMode === 'transport') {
      e.preventDefault();
      if (e.keyCode === KEY.LEFT) {
        setTransportFocus(f => Math.max(0, f - 1)); showControlsFor();
      } else if (e.keyCode === KEY.RIGHT) {
        setTransportFocus(f => Math.min(s.maxTransportIdx, f + 1)); showControlsFor();
      } else if (e.keyCode === KEY.OK) {
        s.activateTransportBtn(s.transportFocus); showControlsFor();
      } else if (e.keyCode === KEY.UP) {
        setNavMode('seek'); setPendingSeekTime(video.currentTime); showControlsFor(8000);
      } else if (e.keyCode === KEY.DOWN && s.hasMenu) {
        s.openMenu('audio');
      } else if (e.keyCode === KEY.BACK) {
        hideControls();
      } else if (e.keyCode === KEY.PLAY_PAUSE || e.keyCode === KEY.PLAY || e.keyCode === KEY.PAUSE) {
        video.paused ? video.play().catch(() => {}) : video.pause(); showControlsFor();
      }
      return;
    }

    // ── Play (aucun focus) ───────────────────────────────────────────────
    if (e.keyCode === KEY.BACK) {
      e.preventDefault();
      // 1er BACK : masque l'overlay (sans attendre l'auto-masquage) ; 2e BACK : quitte la lecture
      if (s.showControls) { hideControls(); return; }
      watchProgress.save(s.mediaId, s.episodeId, video.currentTime, video.duration || s.durationSeconds || 0);
      s.onBack();
      return;
    }
    showControlsFor();
    if (e.keyCode === KEY.DOWN) {
      e.preventDefault();
      setNavMode('transport'); setTransportFocus(2);
    } else if (e.keyCode === KEY.UP) {
      e.preventDefault();
      setNavMode('seek'); setPendingSeekTime(video.currentTime); showControlsFor(8000);
    } else if (e.keyCode === KEY.OK || e.keyCode === KEY.PLAY_PAUSE || e.keyCode === KEY.PLAY || e.keyCode === KEY.PAUSE) {
      e.preventDefault();
      video.paused ? video.play().catch(() => {}) : video.pause();
      setNavMode('transport'); setTransportFocus(2);
    } else if (e.keyCode === KEY.FF) {
      e.preventDefault();
      const t = Math.min(video.currentTime + 30, video.duration || 0); video.currentTime = t; showSeekHint('+30s');
    } else if (e.keyCode === KEY.RW) {
      e.preventDefault();
      const t = Math.max(video.currentTime - 30, 0); video.currentTime = t; showSeekHint('−30s');
    } else if (e.keyCode === KEY.RIGHT) {
      e.preventDefault();
      const t = Math.min(video.currentTime + 10, video.duration || 0); video.currentTime = t; showSeekHint('+10s');
    } else if (e.keyCode === KEY.LEFT) {
      e.preventDefault();
      const t = Math.max(video.currentTime - 10, 0); video.currentTime = t; showSeekHint('−10s');
    } else if (e.keyCode === KEY.STOP) {
      e.preventDefault();
      watchProgress.save(s.mediaId, s.episodeId, video.currentTime, video.duration || s.durationSeconds || 0);
      s.onBack();
    }
  }, []); // stable handler via stateRef

  const duration = durationSeconds || videoRef.current?.duration || 0;
  const displayTime = pendingSeekTime ?? currentTime;
  const progress = duration > 0 ? (displayTime / duration) * 100 : 0;

  const audioSummary = (() => {
    const t = effectiveAudioTracks[activeAudio];
    if (!t) return 'Audio';
    const lang = langName(t.language) || t.title;
    return `${lang}${t.channels > 0 ? ` · ${channelLabel(t.channels)}` : ''}`;
  })();

  const subSummary = activeSubtitle < 0
    ? 'Désactivés'
    : (effectiveSubtitles[activeSubtitle] ? (langName(effectiveSubtitles[activeSubtitle].language) || effectiveSubtitles[activeSubtitle].title) : 'Désactivés');

  const now = new Date();
  const clockTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return {
    showControls, navMode, transportFocus,
    seekMode: navMode === 'seek',
    menuOpen: navMode === 'menu',
    menuSection, menuIndex, currentItems, seekHint, pendingSeekTime,
    displayTime, progress, duration, audioSummary, subSummary,
    hasTracks, hasMenu, hasPrevEpisode, hasNextEpisode, clockTime,
    doResume, doStartOver, showControlsFor, activateTransportBtn, openMenu, selectMenuItem,
  };
}
