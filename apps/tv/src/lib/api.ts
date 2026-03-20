import { tokens } from './tokens';
import type { CineClubResponse, LoginResponse, UserResponse } from '@nasflix/shared';

const BASE = import.meta.env.VITE_API_URL || '/api';

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

export function getNasStatus() {
  return request<{ online: boolean }>('/nas/status');
}

export function wakeNas() {
  return request<{ sent: boolean; message: string }>('/nas/wake', { method: 'POST' });
}

export function getStreamUrl(mediaId: number) {
  return request<{ url: string; isHls: boolean; durationSeconds: number }>(`/nas/stream/${mediaId}?mode=stream&passthrough=1`);
}

export function getEpisodeStreamUrl(episodeId: number) {
  return request<{ url: string; isHls: boolean; durationSeconds: number }>(`/nas/stream/episode/${episodeId}?mode=stream&passthrough=1`);
}
