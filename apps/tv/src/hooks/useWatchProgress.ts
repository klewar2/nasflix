import { useEffect, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { watchProgress } from '../lib/progress';
import type { WatchProgress } from '../lib/progress';

interface Params {
  videoRef: RefObject<HTMLVideoElement | null>;
  mediaId: number;
  episodeId: number | undefined;
  durationSeconds: number;
  initialSavedProgress: WatchProgress | null;
}

interface Return {
  savedProgress: WatchProgress | null;
  showResume: boolean;
  setShowResume: Dispatch<SetStateAction<boolean>>;
  resumeCountdown: number;
}

export function useWatchProgress({ videoRef, mediaId, episodeId, durationSeconds, initialSavedProgress }: Params): Return {
  const savedProgress = initialSavedProgress;
  const [showResume, setShowResume] = useState(!!savedProgress && savedProgress.currentTime > 10);
  const [resumeCountdown, setResumeCountdown] = useState(8);

  // Auto-countdown → auto-play when prompt dismissed by timer
  useEffect(() => {
    if (!showResume) return;
    const interval = setInterval(() => {
      setResumeCountdown(c => {
        if (c <= 1) {
          clearInterval(interval);
          setShowResume(false);
          videoRef.current?.play().catch(() => {});
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [showResume, videoRef]);

  // Auto-save every 15s during playback
  const autoSaveRef = useRef({ mediaId, episodeId, durationSeconds });
  autoSaveRef.current = { mediaId, episodeId, durationSeconds };
  useEffect(() => {
    const timer = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.paused) return;
      const { mediaId: mId, episodeId: eId, durationSeconds: dur } = autoSaveRef.current;
      watchProgress.save(mId, eId, video.currentTime, video.duration || dur || 0);
    }, 15_000);
    return () => clearInterval(timer);
  }, [videoRef]);

  // Save on unmount
  const unmountRef = useRef({ mediaId, episodeId, durationSeconds });
  unmountRef.current = { mediaId, episodeId, durationSeconds };
  useEffect(() => {
    return () => {
      const video = videoRef.current;
      if (!video) return;
      const { mediaId: mId, episodeId: eId, durationSeconds: dur } = unmountRef.current;
      watchProgress.save(mId, eId, video.currentTime, video.duration || dur || 0);
    };
  }, [videoRef]);

  return { savedProgress, showResume, setShowResume, resumeCountdown };
}
