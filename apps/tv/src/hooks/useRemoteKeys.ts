import { useEffect } from 'react';

export const KEY = {
  UP: 38, DOWN: 40, LEFT: 37, RIGHT: 39,
  OK: 13, BACK: 461,
  PLAY: 415, PAUSE: 19, PLAY_PAUSE: 10252,
  FF: 417, RW: 412, STOP: 413,
} as const;

type Handler = (e: KeyboardEvent) => void;

/** Attache un listener keydown sur document, retiré au unmount. */
export function useRemoteKeys(handler: Handler, deps: unknown[] = []) {
  useEffect(() => {
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
