/**
 * Watch progress persistence via localStorage.
 * Saves position every ~15s during playback; clears when >95% watched.
 */

const PREFIX = 'nf_prog_';

function key(mediaId: number, episodeId?: number): string {
  return `${PREFIX}${mediaId}_${episodeId ?? 'm'}`;
}

export interface WatchProgress {
  currentTime: number;
  duration: number;
  savedAt: number; // unix ms
}

export const watchProgress = {
  get(mediaId: number, episodeId?: number): WatchProgress | null {
    try {
      const raw = localStorage.getItem(key(mediaId, episodeId));
      if (!raw) return null;
      const p = JSON.parse(raw) as WatchProgress;
      // Ignore entries older than 90 days
      if (Date.now() - p.savedAt > 90 * 24 * 3600 * 1000) {
        localStorage.removeItem(key(mediaId, episodeId));
        return null;
      }
      return p;
    } catch { return null; }
  },

  save(mediaId: number, episodeId: number | undefined, currentTime: number, duration: number) {
    if (!duration || duration <= 0) return;
    const pct = currentTime / duration;
    if (pct < 0.01) return; // barely started — don't save
    if (pct > 0.95) {
      // Finished — clear
      localStorage.removeItem(key(mediaId, episodeId));
      return;
    }
    try {
      localStorage.setItem(key(mediaId, episodeId), JSON.stringify({
        currentTime, duration, savedAt: Date.now(),
      }));
    } catch { /* quota exceeded — ignore */ }
  },

  clear(mediaId: number, episodeId?: number) {
    localStorage.removeItem(key(mediaId, episodeId));
  },

  /** Returns progress % (0-100) for displaying on cards/episode list */
  pct(mediaId: number, episodeId?: number): number {
    const p = watchProgress.get(mediaId, episodeId);
    if (!p || !p.duration) return 0;
    return Math.min(100, (p.currentTime / p.duration) * 100);
  },
};
