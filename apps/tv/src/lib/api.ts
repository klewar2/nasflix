import { tokens } from './tokens';
import type {
  CineClubResponse,
  LoginResponse,
  MediaDetailResponse,
  MediaResponse,
  MediaTracks,
  NasImageSubtitleStatus,
  NasSubtitleTrack,
  PaginatedResponse,
  StreamUrlResponse,
  UserResponse,
} from '@nasflix/shared';

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

  if (res.status === 401 && tokens.getAccess()) {
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

/** Comme `request`, pour une réponse binaire (sous-titres PGS .sup). */
async function requestBinary(path: string): Promise<ArrayBuffer> {
  const token = tokens.getAccess();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { headers });

  if (res.status === 401 && tokens.getAccess()) {
    tokens.clear();
    window.location.reload();
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Erreur réseau' }));
    throw new Error((err as { message?: string }).message || `HTTP ${res.status}`);
  }
  return res.arrayBuffer();
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

export function getCineClubMembers(id: number) {
  return request<Array<{ role: string; user: { id: number; username: string; firstName: string; lastName: string } }>>(`/cineclubs/${id}/members`);
}

export async function getHealth(): Promise<{ status: string; nas: 'ok' | 'offline' | 'unknown'; db: string }> {
  try {
    const res = await fetch(`${BASE}/health`);
    if (!res.ok) return { status: 'error', nas: 'unknown', db: 'error' };
    return res.json() as Promise<{ status: string; nas: 'ok' | 'offline' | 'unknown'; db: string }>;
  } catch {
    return { status: 'error', nas: 'unknown', db: 'error' };
  }
}

export function selectCineClub(id: number) {
  return request<{ accessToken: string; refreshToken: string }>(`/auth/cineclubs/${id}/select`, { method: 'POST' });
}

// ── Media ─────────────────────────────────────────────────────────────────

export function getMedia(params: Record<string, string | number> = {}) {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return request<PaginatedResponse<MediaResponse>>(`/media?${q}`);
}

export function getRecentMedia(limit = 20) {
  return request<MediaResponse[]>(`/media/recent?limit=${limit}`);
}

export function getMediaById(id: number) {
  return request<MediaDetailResponse>(`/media/${id}`);
}

// ── NAS ───────────────────────────────────────────────────────────────────

export type { MediaTracks, NasImageSubtitleStatus, NasSubtitleTrack };

export function getNasStatus() {
  return request<{ online: boolean }>('/nas/status');
}

export function wakeNas() {
  return request<{ sent: boolean; message: string }>('/nas/wake', { method: 'POST' });
}

export async function getStreamUrl(mediaId: number, audioTrack = 1) {
  const r = await request<StreamUrlResponse>(`/nas/stream/${mediaId}?mode=stream&passthrough=1&audioTrack=${audioTrack}&client=tv`);
  return { ...r, url: resolveApiUrl(r.url) };
}

export async function getEpisodeStreamUrl(episodeId: number, audioTrack = 1) {
  const r = await request<StreamUrlResponse>(`/nas/stream/episode/${episodeId}?mode=stream&passthrough=1&audioTrack=${audioTrack}&client=tv`);
  return { ...r, url: resolveApiUrl(r.url) };
}

export function getMediaTracks(mediaId: number) {
  return request<MediaTracks>(`/nas/tracks/${mediaId}`);
}

export function getEpisodeTracks(episodeId: number) {
  return request<MediaTracks>(`/nas/tracks/episode/${episodeId}`);
}

type SubtitleMeta = { language?: string; title?: string; codec?: string };

function subtitleMetaQuery(meta: SubtitleMeta = {}): string {
  const q = new URLSearchParams();
  if (meta.language) q.set('lang', meta.language);
  if (meta.title) q.set('title', meta.title);
  if (meta.codec) q.set('codec', meta.codec);
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** Extraction VTT d'une seule piste sous-titre NAS (à la demande, cachée côté backend). */
export function getNasSubtitleTrack(mediaId: number, trackIdx: number, meta?: SubtitleMeta) {
  return request<NasSubtitleTrack>(`/nas/subtitles/${mediaId}/track/${trackIdx}${subtitleMetaQuery(meta)}`);
}

export function getNasEpisodeSubtitleTrack(episodeId: number, trackIdx: number, meta?: SubtitleMeta) {
  return request<NasSubtitleTrack>(`/nas/subtitles/episode/${episodeId}/track/${trackIdx}${subtitleMetaQuery(meta)}`);
}

/** Sous-titre image PGS : état de l'extraction (à re-sonder tant que `pending`). */
export function getNasImageSubtitle(mediaId: number, trackIdx: number, meta?: SubtitleMeta) {
  return request<NasImageSubtitleStatus>(`/nas/subtitles/${mediaId}/image/${trackIdx}${subtitleMetaQuery(meta)}`);
}

export function getNasEpisodeImageSubtitle(episodeId: number, trackIdx: number, meta?: SubtitleMeta) {
  return request<NasImageSubtitleStatus>(`/nas/subtitles/episode/${episodeId}/image/${trackIdx}${subtitleMetaQuery(meta)}`);
}

/** Contenu .sup d'une piste PGS extraite (`ready`). */
export function getNasImageSubtitleData(mediaId: number, trackIdx: number) {
  return requestBinary(`/nas/subtitles/${mediaId}/image/${trackIdx}/data`);
}

export function getNasEpisodeImageSubtitleData(episodeId: number, trackIdx: number) {
  return requestBinary(`/nas/subtitles/episode/${episodeId}/image/${trackIdx}/data`);
}

export function getPreferences() {
  return request<{ streamingQuality: 'NATIVE' | 'DIRECT' }>('/auth/me/preferences');
}

export function updatePreferences(streamingQuality: 'NATIVE' | 'DIRECT') {
  return request<{ streamingQuality: 'NATIVE' | 'DIRECT' }>('/auth/me/preferences', {
    method: 'PATCH',
    body: JSON.stringify({ streamingQuality }),
  });
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
