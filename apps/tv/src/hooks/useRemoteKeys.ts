import { useEffect } from 'react';

export const KEY = {
  UP: 38, DOWN: 40, LEFT: 37, RIGHT: 39,
  OK: 13, BACK: 461,
  PLAY: 415, PAUSE: 19, PLAY_PAUSE: 10252,
  FF: 417, RW: 412, STOP: 413,
  GREEN: 404,
} as const;

type Handler = (e: KeyboardEvent) => void;

/** Attache un listener keydown sur document, retiré au unmount. */
export function useRemoteKeys(handler: Handler, deps: unknown[] = []) {
  useEffect(() => {
    // capture:true pour intercepter avant que webOS ne traite la touche BACK
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
