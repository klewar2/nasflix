import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import Hls from 'hls.js';
import type { PgsRenderer } from 'libpgs';
import type { PgsRendererMode } from 'libpgs/dist/pgsRendererMode';
import {
  getStreamUrl, getEpisodeStreamUrl, getNasSubtitleTrack, getNasEpisodeSubtitleTrack,
  getNasImageSubtitle, getNasEpisodeImageSubtitle, getNasImageSubtitleData, getNasEpisodeImageSubtitleData,
} from '../lib/api';
import type { MediaTracks } from '../lib/api';
import { HLS_CONFIG, isPgsSubtitleCodec, isTextSubtitleCodec, langName, parseVTT } from './utils';
import type { AudioTrack, SubtitleTrack } from './utils';
import type { HlsAudioTrack } from './useVideoCore';

interface Params {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Canvas superposé à la vidéo, où libpgs dessine les sous-titres PGS. */
  pgsCanvasRef: RefObject<HTMLCanvasElement | null>;
  hlsRef: MutableRefObject<Hls | null>;
  url: string;
  isHls: boolean;
  hlsAudioTracks: HlsAudioTrack[];
  setHlsAudioTracks: Dispatch<SetStateAction<HlsAudioTrack[]>>;
  setActiveAudio: Dispatch<SetStateAction<number>>;
  tracks: MediaTracks | undefined;
  sourceType: 'NAS' | 'SEEDBOX' | undefined;
  jellyfinItemId: string | undefined;
  jellyfinBaseUrl: string | undefined;
  jellyfinApiToken: string | undefined;
  currentTime: number;
  mediaId: number;
  episodeId: number | undefined;
  urlChangeKey: number;
}

interface Return {
  effectiveAudioTracks: AudioTrack[];
  effectiveSubtitles: SubtitleTrack[];
  activeSubtitle: number;
  activeCueHtml: string | null;
  subtitleLoading: boolean;
  subtitleProgress: number | null;
  nativeAudioTracks: AudioTrack[];
  nativeSubtitleTracks: SubtitleTrack[];
  applyAudioTrack: (index: number) => Promise<void>;
  applySubtitle: (index: number) => Promise<void>;
}

export function useVideoTracks({
  videoRef, pgsCanvasRef, hlsRef, url, isHls, hlsAudioTracks, setHlsAudioTracks, setActiveAudio,
  tracks, sourceType, jellyfinItemId, jellyfinBaseUrl, jellyfinApiToken,
  currentTime, mediaId, episodeId, urlChangeKey,
}: Params): Return {
  const [nativeAudioTracks, setNativeAudioTracks] = useState<AudioTrack[]>([]);
  const [nativeSubtitleTracks, setNativeSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [activeSubtitle, setActiveSubtitle] = useState(-1);
  const [subtitleCues, setSubtitleCues] = useState<Array<{ start: number; end: number; html: string }>>([]);
  const [subtitleLoading, setSubtitleLoading] = useState(false);
  const [subtitleProgress, setSubtitleProgress] = useState<number | null>(null);

  // Unified cue cache: key → cues[]
  // NAS: key = nasTrackIdx, SEEDBOX: key = jellyfinIndex
  const cueCacheRef = useRef<Map<number, Array<{ start: number; end: number; html: string }>>>(new Map());
  // Génération de polling : incrémentée au changement de média pour stopper les sondages en cours
  const pollGenRef = useRef(0);
  // Sous-titres PGS : renderer actif + .sup déjà téléchargés (clé = index FFmpeg de la piste)
  const pgsRendererRef = useRef<PgsRenderer | null>(null);
  const pgsDataCacheRef = useRef<Map<number, ArrayBuffer>>(new Map());
  // Incrémenté à chaque choix de sous-titre : un chargement PGS dépassé par un autre choix est abandonné
  const selectionGenRef = useRef(0);

  const disposePgs = useCallback(() => {
    pgsRendererRef.current?.dispose();
    pgsRendererRef.current = null;
    // dispose() ne vide pas un canvas fourni par l'appelant
    const canvas = pgsCanvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }, [pgsCanvasRef]);

  // Reset all subtitle state on media change
  useEffect(() => {
    setActiveSubtitle(-1);
    setSubtitleCues([]);
    setSubtitleProgress(null);
    cueCacheRef.current = new Map();
    pgsDataCacheRef.current = new Map();
    pollGenRef.current += 1;
    selectionGenRef.current += 1;
    disposePgs();
  }, [urlChangeKey, disposePgs]);

  useEffect(() => disposePgs, [disposePgs]);

  // NAS : extraction VTT d'une piste à la demande (backend), mise en cache locale par index FFmpeg.
  // L'extraction API est asynchrone (réponse immédiate pending + progression) : on re-sonde
  // toutes les 4 s jusqu'au VTT — jamais de requête HTTP longue à travers l'edge Railway.
  const fetchNasTrackCues = useCallback(async (track: SubtitleTrack) => {
    const key = track.nasTrackIdx ?? track.index;
    const existing = cueCacheRef.current.get(key);
    if (existing) return existing;
    const meta = { language: track.language, title: track.title, codec: track.codec };
    const call = () => episodeId
      ? getNasEpisodeSubtitleTrack(episodeId, key, meta)
      : getNasSubtitleTrack(mediaId, key, meta);

    const gen = pollGenRef.current;
    try {
      let res = await call();
      for (let attempt = 0; res.pending; attempt++) {
        if (attempt > 225) throw new Error('extraction sous-titres : timeout'); // ~15 min
        setSubtitleProgress(res.progressPercent ?? 0);
        await new Promise((r) => setTimeout(r, 4000));
        if (pollGenRef.current !== gen) throw new Error('extraction sous-titres : annulée (changement de média)');
        res = await call();
      }
      const cues = parseVTT(res.vttContent);
      cueCacheRef.current.set(key, cues);
      return cues;
    } finally {
      setSubtitleProgress(null);
    }
  }, [episodeId, mediaId]);

  // NAS PGS : le .sup est extrait côté API (souvent déjà fait par la pré-extraction), on re-sonde
  // l'état toutes les 4 s jusqu'à `ready` puis on télécharge le binaire (quelques Mo).
  const fetchNasPgsData = useCallback(async (track: SubtitleTrack) => {
    const key = track.nasTrackIdx ?? track.index;
    const existing = pgsDataCacheRef.current.get(key);
    if (existing) return existing;
    const meta = { language: track.language, codec: track.codec };
    const status = () => episodeId
      ? getNasEpisodeImageSubtitle(episodeId, key, meta)
      : getNasImageSubtitle(mediaId, key, meta);

    const gen = pollGenRef.current;
    try {
      let res = await status();
      for (let attempt = 0; !res.ready; attempt++) {
        // Lecture complète d'un remux UHD sur le NAS : jusqu'à ~30 min côté API
        if (attempt > 450) throw new Error('extraction sous-titres PGS : timeout');
        setSubtitleProgress(res.progressPercent ?? 0);
        await new Promise((r) => setTimeout(r, 4000));
        if (pollGenRef.current !== gen) throw new Error('extraction sous-titres PGS : annulée (changement de média)');
        res = await status();
      }
      const data = episodeId
        ? await getNasEpisodeImageSubtitleData(episodeId, key)
        : await getNasImageSubtitleData(mediaId, key);
      pgsDataCacheRef.current.set(key, data);
      return data;
    } finally {
      setSubtitleProgress(null);
    }
  }, [episodeId, mediaId]);

  // Background-preload preferred subtitle (fr > en) for NAS sources.
  // Sauté si webOS expose déjà les pistes intégrées (rendu natif, aucun Railway nécessaire).
  useEffect(() => {
    if (sourceType !== 'NAS' || nativeSubtitleTracks.length > 0) return;
    const subs = (tracks?.subtitles ?? []).filter(t => isTextSubtitleCodec(t.codec));
    if (subs.length === 0) return;
    const preferred = subs.find(t => ['fr', 'fra', 'fre'].includes(t.language.toLowerCase()))
      ?? subs.find(t => ['en', 'eng'].includes(t.language.toLowerCase()))
      ?? subs[0];
    if (!preferred || cueCacheRef.current.has(preferred.index)) return;
    fetchNasTrackCues({ index: preferred.index, nasTrackIdx: preferred.index, language: preferred.language, title: preferred.title, codec: preferred.codec })
      .catch(() => { /* préchargement best-effort */ });
  }, [sourceType, tracks, nativeSubtitleTracks, fetchNasTrackCues]);

  // Background-preload preferred subtitle (fr > en) for SEEDBOX sources
  useEffect(() => {
    if (sourceType !== 'SEEDBOX' || !jellyfinBaseUrl || !jellyfinItemId || !jellyfinApiToken) return;
    const subs = nativeSubtitleTracks.length > 0 ? nativeSubtitleTracks : (tracks?.subtitles ?? []);
    if (subs.length === 0) return;

    const preferred = subs.find(t => t.language === 'fr')
      ?? subs.find(t => t.language === 'en')
      ?? subs[0];
    if (!preferred || typeof preferred.jellyfinIndex !== 'number') return;

    const targetIndex = preferred.jellyfinIndex;
    if (cueCacheRef.current.has(targetIndex)) return;

    let cancelled = false;
    const base = jellyfinBaseUrl.replace(/\/$/, '');
    const vttUrl = `${base}/Videos/${jellyfinItemId}/${jellyfinItemId}/Subtitles/${targetIndex}/0/Stream.vtt?api_key=${jellyfinApiToken}`;

    fetch(vttUrl).then(async res => {
      if (cancelled || !res.ok) return;
      const cues = parseVTT(await res.text());
      if (!cancelled) cueCacheRef.current.set(targetIndex, cues);
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [sourceType, jellyfinBaseUrl, jellyfinItemId, jellyfinApiToken, nativeSubtitleTracks, tracks]);

  // Native audio/subtitle track detection (non-HLS)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isHls) return;

    const readNativeTracks = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const at = (video as any).audioTracks as { length: number; [i: number]: { enabled: boolean; language?: string; label?: string } } | undefined;
      if (at && at.length > 0) {
        const parsed: AudioTrack[] = [];
        for (let i = 0; i < at.length; i++) {
          const t = at[i];
          const lang = t.language || '';
          const lname = langName(lang);
          const label = (t.label && t.label !== lang && !/^\d+$/.test(t.label)) ? t.label : lname || `Piste ${i + 1}`;
          parsed.push({ index: i, title: label, language: lang, codec: '', channels: 0 });
        }
        setNativeAudioTracks(parsed);
        for (let i = 0; i < at.length; i++) {
          if (at[i].enabled) { setActiveAudio(i); break; }
        }
      } else {
        setNativeAudioTracks([]);
      }

      const tt = video.textTracks;
      if (tt && tt.length > 0) {
        const parsed: SubtitleTrack[] = [];
        for (let i = 0; i < tt.length; i++) {
          const t = tt[i];
          if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
          const lang = t.language || '';
          const label = (t.label && t.label !== lang) ? t.label : langName(lang) || `Sous-titre ${parsed.length + 1}`;
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
  }, [url, isHls, videoRef, setActiveAudio]);

  const effectiveAudioTracks: AudioTrack[] = isHls && hlsAudioTracks.length > 0
    ? hlsAudioTracks.map(t => ({ index: t.id, title: t.name, language: t.lang, codec: '', channels: 0 }))
    : nativeAudioTracks.length > 0 ? nativeAudioTracks : (tracks?.audio ?? []);

  const effectiveSubtitles: SubtitleTrack[] = useMemo(() => {
    if (sourceType === 'NAS') {
      // 1) Si webOS expose les pistes sous-titres intégrées au .mkv (textTracks), on les rend
      //    nativement : chargement direct par la TV depuis le NAS, sans Railway ni FFmpeg.
      if (nativeSubtitleTracks.length > 0) return nativeSubtitleTracks;
      // 2) Sinon : liste via le sondage FFmpeg (Railway), VTT extrait à la demande.
      //    nasTrackIdx = index FFmpeg réel (0:s:N). On liste TOUTES les pistes détectées
      //    (y compris image/PGS) — le codec est affiché dans le menu pour diagnostic.
      return (tracks?.subtitles ?? [])
        .map((t, i) => ({
          index: i,
          nasTrackIdx: t.index,
          language: t.language,
          title: t.title,
          codec: t.codec,
        }));
    }
    if (nativeSubtitleTracks.length > 0) return nativeSubtitleTracks;
    return tracks?.subtitles ?? [];
  }, [sourceType, nativeSubtitleTracks, tracks]);

  const activeCueHtml = useMemo(() => {
    if (activeSubtitle === -1 || subtitleCues.length === 0) return null;
    return subtitleCues.find(c => currentTime >= c.start && currentTime < c.end)?.html ?? null;
  }, [currentTime, subtitleCues, activeSubtitle]);

  const applyAudioTrack = useCallback(async (index: number) => {
    const video = videoRef.current;
    if (!video) return;

    if (isHls && hlsRef.current) {
      if (hlsAudioTracks.length > 1) {
        hlsRef.current.audioTrack = index;
      } else if (sourceType === 'SEEDBOX') {
        const savedTime = video.currentTime;
        try {
          const newUrl = (() => {
            try { const u = new URL(url); u.searchParams.set('AudioStreamIndex', String(index)); return u.toString(); }
            catch { return url; }
          })();
          hlsRef.current.destroy();
          const hls = new Hls(HLS_CONFIG);
          hlsRef.current = hls;
          hls.loadSource(newUrl);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => { video.currentTime = savedTime; video.play().catch(() => {}); });
          setActiveAudio(index);
        } catch { /* ignore */ }
      } else {
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
          hls.on(Hls.Events.MANIFEST_PARSED, () => { video.currentTime = savedTime; video.play().catch(() => {}); });
          hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
            setHlsAudioTracks(data.audioTracks.map(t => ({ id: t.id, name: t.name || t.lang || `Piste ${t.id + 1}`, lang: t.lang || '' })));
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
  }, [videoRef, hlsRef, isHls, hlsAudioTracks, sourceType, url, episodeId, mediaId, setHlsAudioTracks, setActiveAudio]);

  const applySubtitle = useCallback(async (index: number) => {
    const video = videoRef.current;
    if (video) {
      const tt = video.textTracks;
      for (let i = 0; i < tt.length; i++) tt[i].mode = 'disabled';
    }
    const selection = ++selectionGenRef.current;
    disposePgs();
    if (index === -1) { setSubtitleCues([]); setActiveSubtitle(-1); return; }

    const track = effectiveSubtitles[index];
    if (!track) return;

    // NAS via sondage FFmpeg : VTT extrait à la demande côté backend (lent la 1re fois, puis caché).
    // Les pistes natives webOS (sans nasTrackIdx) retombent plus bas sur le rendu natif.
    if (sourceType === 'NAS' && track.nasTrackIdx !== undefined) {
      // PGS (Blu-ray) : .sup extrait côté API puis dessiné sur le canvas par libpgs.
      if (isPgsSubtitleCodec(track.codec)) {
        setSubtitleCues([]);
        setSubtitleLoading(true);
        try {
          const data = await fetchNasPgsData(track);
          const canvas = pgsCanvasRef.current;
          if (selectionGenRef.current !== selection || !video || !canvas) return;
          // Chargé à la demande : seuls les films à sous-titres PGS paient ce module
          const { PgsRenderer } = await import('libpgs');
          if (selectionGenRef.current !== selection) return;
          // Rendu dans le thread principal : un worker exige un fichier JS séparé, peu fiable
          // dans une app servie en file://, et ne répond pas sur webOS ≤ 5 (cf. libpgs).
          const renderer = new PgsRenderer({ video, canvas, mode: 'mainThread' as PgsRendererMode });
          pgsRendererRef.current = renderer;
          await renderer.loadFromBuffer(data);
          if (selectionGenRef.current !== selection) return;
          renderer.renderAtTimestamp(video.currentTime);
          setActiveSubtitle(index);
          console.info(`[NasflixTV] PGS subtitles loaded ${JSON.stringify({ lang: track.language, bytes: data.byteLength })}`);
        } catch (e) {
          console.error('[VideoPlayer] PGS subtitle failed', e);
          if (selectionGenRef.current === selection) disposePgs();
        } finally {
          if (selectionGenRef.current === selection) setSubtitleLoading(false);
        }
        return;
      }
      // Autres sous-titres image (VOBSUB…) : non convertibles en VTT sans OCR → on n'extrait pas.
      if (!isTextSubtitleCodec(track.codec)) {
        console.warn(`[NasflixTV] subtitle track ${track.nasTrackIdx} codec=${track.codec} (image) non supporté`);
        setSubtitleCues([]);
        setActiveSubtitle(index);
        return;
      }
      const cacheKey = track.nasTrackIdx ?? index;
      const cached = cueCacheRef.current.get(cacheKey);
      if (cached) {
        setSubtitleCues(cached);
        setActiveSubtitle(index);
        return;
      }
      setSubtitleLoading(true);
      try {
        const cues = await fetchNasTrackCues(track);
        setSubtitleCues(cues);
        setActiveSubtitle(index);
        console.info(`[NasflixTV] NAS subtitles loaded ${JSON.stringify({ lang: track.language })}`);
      } catch (e) {
        console.error('[VideoPlayer] NAS subtitle fetch failed', e);
        setSubtitleCues([]);
      } finally {
        setSubtitleLoading(false);
      }
      return;
    }

    // SEEDBOX: check cache first (background preload), fetch from Jellyfin if needed
    if (sourceType === 'SEEDBOX' && typeof track.jellyfinIndex === 'number' && jellyfinBaseUrl && jellyfinItemId && jellyfinApiToken) {
      const cached = cueCacheRef.current.get(track.jellyfinIndex);
      if (cached) {
        setSubtitleCues(cached);
        setActiveSubtitle(index);
        return;
      }
      setSubtitleLoading(true);
      try {
        const base = jellyfinBaseUrl.replace(/\/$/, '');
        const vttUrl = `${base}/Videos/${jellyfinItemId}/${jellyfinItemId}/Subtitles/${track.jellyfinIndex}/0/Stream.vtt?api_key=${jellyfinApiToken}`;
        const res = await fetch(vttUrl);
        if (!res.ok) throw new Error(`VTT ${res.status}`);
        const cues = parseVTT(await res.text());
        cueCacheRef.current.set(track.jellyfinIndex, cues);
        setSubtitleCues(cues);
        setActiveSubtitle(index);
        console.info(`[NasflixTV] subtitles loaded ${JSON.stringify({ lang: track.language })}`);
      } catch (e) {
        console.error('[VideoPlayer] subtitle fetch failed', e);
        setSubtitleCues([]);
      } finally {
        setSubtitleLoading(false);
      }
      return;
    }

    // Pistes natives (webOS / navigateur rendent les sous-titres intégrés lui-même — aucun Railway)
    if (video) {
      const tt = video.textTracks;
      for (let i = 0; i < tt.length; i++) tt[i].mode = (i === track.index) ? 'showing' : 'disabled';
    }
    setActiveSubtitle(index);
  }, [videoRef, pgsCanvasRef, effectiveSubtitles, sourceType, jellyfinBaseUrl, jellyfinItemId, jellyfinApiToken, fetchNasTrackCues, fetchNasPgsData, disposePgs]);

  return {
    effectiveAudioTracks, effectiveSubtitles, activeSubtitle, activeCueHtml,
    subtitleLoading, subtitleProgress, nativeAudioTracks, nativeSubtitleTracks, applyAudioTrack, applySubtitle,
  };
}
