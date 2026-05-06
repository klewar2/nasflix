export const LANG_LABELS: Record<string, string> = {
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

export function langName(code: string): string {
  if (!code) return '';
  const key = code.toLowerCase().replace(/-.*/, '');
  return LANG_LABELS[key] || code.toUpperCase();
}

export function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function channelLabel(n: number): string {
  if (n >= 8) return '7.1';
  if (n >= 6) return '5.1';
  if (n >= 3) return '2.1';
  if (n === 2) return 'Stéréo';
  return 'Mono';
}

export function parseVttTime(t: string): number {
  const parts = t.trim().split(':');
  if (parts.length === 3) return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
}

export function parseVTT(text: string): Array<{ start: number; end: number; html: string }> {
  const cues: Array<{ start: number; end: number; html: string }> = [];
  const normalized = text.replace(/﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block.trim().split('\n');
    const tcIdx = lines.findIndex(l => l.includes('-->'));
    if (tcIdx === -1) continue;
    const match = lines[tcIdx].match(/(\d[\d:.]+)\s+-->\s+(\d[\d:.]+)/);
    if (!match) continue;
    const html = lines.slice(tcIdx + 1).join('<br>').trim().replace(/<\d+:\d+:\d+\.\d+>/g, '');
    if (html) cues.push({ start: parseVttTime(match[1]), end: parseVttTime(match[2]), html });
  }
  return cues;
}

export const HLS_CONFIG = {
  enableWorker: true,
  maxBufferLength: 30,
  fragLoadingTimeOut: 120_000,
  manifestLoadingTimeOut: 30_000,
  levelLoadingTimeOut: 30_000,
  fragLoadingMaxRetry: 6,
  fragLoadingRetryDelay: 2000,
  startLevel: 0,
} as const;

export type TrackSection = 'audio' | 'subtitle';

export type AudioTrack = { index: number; title: string; language: string; codec: string; channels: number };
export type SubtitleTrack = { index: number; title: string; language: string; codec: string; jellyfinIndex?: number; nasTrackIdx?: number };
export type TrackItem = { index: number; title: string; language: string; codec: string; jellyfinIndex?: number; nasTrackIdx?: number; channels?: number };
