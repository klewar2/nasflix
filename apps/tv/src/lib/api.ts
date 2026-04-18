import { tokens } from './tokens';
import type { CineClubResponse, LoginResponse, UserResponse } from '@nasflix/shared';

const BASE = import.meta.env.VITE_API_URL || '/api';

/** Résout une URL relative retournée par le backend en URL absolue.
 *  Utilise BASE directement pour conserver le préfixe /api. */
export function resolveApiUrl(url: string): string {
  if (url.startsWith('http')) return url;
  return `${BASE}${url}`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokens.getAccess();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...init, headers });

  if (res.status === 401) {
    tokens.clear();
    window.location.reload();
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Erreur réseau' }));
    throw new Error((err as { message?: string }).message || `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────────────────────────────────

export function login(username: string, password: string) {
  return request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function getMe() {
  return request<UserResponse>('/auth/me');
}

export function getMyCineClubs() {
  return request<CineClubResponse[]>('/auth/me/cineclubs');
}

export function selectCineClub(id: number) {
  return request<{ accessToken: string; refreshToken: string }>(`/auth/cineclubs/${id}/select`, { method: 'POST' });
}

// ── Media ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getMedia(params: Record<string, string | number> = {}): Promise<{ data: any[]; total: number }> {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return request<any>(`/media?${q}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getRecentMedia(limit = 20): Promise<any[]> {
  return request(`/media/recent?limit=${limit}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getMediaById(id: number): Promise<any> {
  return request(`/media/${id}`);
}

// ── NAS ───────────────────────────────────────────────────────────────────

export interface MediaTracks {
  audio: { index: number; language: string; title: string; codec: string; channels: number }[];
  subtitles: { index: number; language: string; title: string; codec: string }[];
}

export function getNasStatus() {
  return request<{ online: boolean }>('/nas/status');
}

export function wakeNas() {
  return request<{ sent: boolean; message: string }>('/nas/wake', { method: 'POST' });
}

export async function getStreamUrl(mediaId: number, audioTrack = 1) {
  const r = await request<{ url: string; isHls: boolean; durationSeconds: number; sourceType?: string; jellyfinItemId?: string; jellyfinBaseUrl?: string; jellyfinApiToken?: string }>(`/nas/stream/${mediaId}?mode=stream&passthrough=1&audioTrack=${audioTrack}`);
  return { ...r, url: resolveApiUrl(r.url) };
}

export async function getEpisodeStreamUrl(episodeId: number, audioTrack = 1) {
  const r = await request<{ url: string; isHls: boolean; durationSeconds: number; sourceType?: string; jellyfinItemId?: string; jellyfinBaseUrl?: string; jellyfinApiToken?: string }>(`/nas/stream/episode/${episodeId}?mode=stream&passthrough=1&audioTrack=${audioTrack}`);
  return { ...r, url: resolveApiUrl(r.url) };
}

export function getMediaTracks(mediaId: number) {
  return request<MediaTracks>(`/nas/tracks/${mediaId}`);
}

export function getEpisodeTracks(episodeId: number) {
  return request<MediaTracks>(`/nas/tracks/episode/${episodeId}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function searchMedia(query: string, limit = 30): Promise<{ data: any[]; total: number }> {
  const q = new URLSearchParams({ q: query, limit: String(limit) });
  return request(`/media/search?${q}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getGenres(): Promise<{ id: number; name: string }[]> {
  return request('/media/genres');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getQualityMedia(type: 'UHD' | 'HDR', limit = 20): Promise<any[]> {
  return request(`/media/quality/${type}?limit=${limit}`);
}
