import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import Hls from 'hls.js';
import { getStreamUrl, getEpisodeStreamUrl } from '../lib/api';
import type { MediaTracks } from '../lib/api';
import { HLS_CONFIG, langName, parseVTT } from './utils';
import type { AudioTrack, SubtitleTrack } from './utils';
import type { HlsAudioTrack } from './useVideoCore';

interface Params {
  videoRef: RefObject<HTMLVideoElement | null>;
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
  nativeAudioTracks: AudioTrack[];
  nativeSubtitleTracks: SubtitleTrack[];
  applyAudioTrack: (index: number) => Promise<void>;
  applySubtitle: (index: number) => Promise<void>;
}

export function useVideoTracks({
  videoRef, hlsRef, url, isHls, hlsAudioTracks, setHlsAudioTracks, setActiveAudio,
  tracks, sourceType, jellyfinItemId, jellyfinBaseUrl, jellyfinApiToken,
  currentTime, mediaId, episodeId, urlChangeKey,
}: Params): Return {
  const [nativeAudioTracks, setNativeAudioTracks] = useState<AudioTrack[]>([]);
  const [nativeSubtitleTracks, setNativeSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [activeSubtitle, setActiveSubtitle] = useState(-1);
  const [subtitleCues, setSubtitleCues] = useState<Array<{ start: number; end: number; html: string }>>([]);
  const [subtitleLoading, setSubtitleLoading] = useState(false);

  // Reset subtitle state on media change
  useEffect(() => {
    setActiveSubtitle(-1);
    setSubtitleCues([]);
  }, [urlChangeKey]);

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

  const effectiveSubtitles: SubtitleTrack[] = nativeSubtitleTracks.length > 0
    ? nativeSubtitleTracks
    : (tracks?.subtitles ?? []);

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
    if (index === -1) { setSubtitleCues([]); setActiveSubtitle(-1); return; }

    const track = effectiveSubtitles[index];
    if (!track) return;

    if (sourceType === 'SEEDBOX' && typeof track.jellyfinIndex === 'number' && jellyfinBaseUrl && jellyfinItemId && jellyfinApiToken) {
      setSubtitleLoading(true);
      try {
        const base = jellyfinBaseUrl.replace(/\/$/, '');
        const vttUrl = `${base}/Videos/${jellyfinItemId}/${jellyfinItemId}/Subtitles/${track.jellyfinIndex}/0/Stream.vtt?api_key=${jellyfinApiToken}`;
        const res = await fetch(vttUrl);
        if (!res.ok) throw new Error(`VTT ${res.status}`);
        setSubtitleCues(parseVTT(await res.text()));
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

    if (video) {
      const tt = video.textTracks;
      for (let i = 0; i < tt.length; i++) tt[i].mode = (i === index) ? 'showing' : 'disabled';
    }
    setActiveSubtitle(index);
  }, [videoRef, effectiveSubtitles, sourceType, jellyfinBaseUrl, jellyfinItemId, jellyfinApiToken]);

  return {
    effectiveAudioTracks, effectiveSubtitles, activeSubtitle, activeCueHtml,
    subtitleLoading, nativeAudioTracks, nativeSubtitleTracks, applyAudioTrack, applySubtitle,
  };
}
