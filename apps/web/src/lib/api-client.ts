import type { PaginatedResponse, AuthTokens, GenreResponse, HealthResponse, JobKind, JobResponse, JobSource, JobStatus, LoginResponse, MediaDetailResponse, MediaResponse, MediaType, RadarrLibraryItem, SonarrLibraryItem, StreamMode, StreamUrlResponse, SyncLogResponse, SyncStatus, UserResponse, CineClubResponse, CineClubMemberResponse } from '@nasflix/shared';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function detectClient(): 'web' | 'tv' {
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent ?? '';
  return /SmartTV|SMART-TV|Tizen|Web0S|WebOS|GoogleTV|AndroidTV|HbbTV|AppleTV|CrKey|Roku/i.test(ua) ? 'tv' : 'web';
}

export function resolveApiUrl(url: string): string {
  if (url.startsWith('http')) return url;
  return `${API_BASE}${url}`;
}

class ApiClient {
  private accessToken: string | null = null;

  constructor() {
    this.accessToken = localStorage.getItem('accessToken');
  }

  private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${API_BASE}${path}`, { ...options, headers });

    if (response.status === 401) {
      this.clearTokens();
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Requête échouée' }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  setTokens(tokens: AuthTokens) {
    this.accessToken = tokens.accessToken;
    localStorage.setItem('accessToken', tokens.accessToken);
    localStorage.setItem('refreshToken', tokens.refreshToken);
  }

  clearTokens() {
    this.accessToken = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('currentCineClub');
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  // Auth
  login(username: string, password: string) {
    return this.fetch<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  getMe() {
    return this.fetch<UserResponse>('/auth/me');
  }

  getMyCineClubs() {
    return this.fetch<CineClubResponse[]>('/auth/me/cineclubs');
  }

  selectCineClub(cineClubId: number) {
    return this.fetch<AuthTokens>(`/auth/cineclubs/${cineClubId}/select`, { method: 'POST' });
  }

  getPreferences() {
    return this.fetch<{ streamingQuality: 'NATIVE' | 'DIRECT' }>('/auth/me/preferences');
  }

  updatePreferences(streamingQuality: 'NATIVE' | 'DIRECT') {
    return this.fetch<{ streamingQuality: 'NATIVE' | 'DIRECT' }>('/auth/me/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ streamingQuality }),
    });
  }

  // CineClubs
  getCineClubs() {
    return this.fetch<CineClubResponse[]>('/cineclubs');
  }

  getCineClub(id: number) {
    return this.fetch<CineClubResponse>(`/cineclubs/${id}`);
  }

  updateCineClub(id: number, data: Record<string, unknown>) {
    return this.fetch<CineClubResponse>(`/cineclubs/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  saveFreeboxToken(freeboxApiUrl: string, appToken: string) {
    return this.fetch<{ saved: boolean }>('/nas/freebox/token', { method: 'POST', body: JSON.stringify({ freeboxApiUrl, appToken }) });
  }

  startFreeboxAuthorization(freeboxApiUrl: string) {
    return this.fetch<{ trackId: number; message: string }>('/nas/freebox/authorize', { method: 'POST', body: JSON.stringify({ freeboxApiUrl }) });
  }

  checkFreeboxAuthorizationStatus(trackId: number) {
    return this.fetch<{ status: string; granted: boolean }>(`/nas/freebox/authorize/${trackId}`);
  }

  generateWebhookSecret(cineClubId: number) {
    return this.fetch<{ webhookSecret: string }>(`/cineclubs/${cineClubId}/generate-webhook-secret`, { method: 'POST' });
  }

  saveJellyfinConfig(jellyfinBaseUrl: string, jellyfinApiToken: string) {
    return this.fetch<{ saved: boolean }>('/nas/jellyfin/config', { method: 'POST', body: JSON.stringify({ jellyfinBaseUrl, jellyfinApiToken }) });
  }

  getJellyfinStatus() {
    return this.fetch<{ online: boolean; version?: string; serverName?: string }>('/nas/jellyfin/status');
  }

  getMediaTracks(mediaId: number) {
    return this.fetch<{ audio: Array<{ index: number; language: string; title: string; codec: string; channels: number }>; subtitles: Array<{ index: number; language: string; title: string; codec: string }> }>(`/nas/tracks/${mediaId}`);
  }

  getEpisodeTracks(episodeId: number) {
    return this.fetch<{ audio: Array<{ index: number; language: string; title: string; codec: string; channels: number }>; subtitles: Array<{ index: number; language: string; title: string; codec: string }> }>(`/nas/tracks/episode/${episodeId}`);
  }

  createCineClub(data: { name: string; slug: string; nasBaseUrl?: string; nasSharedFolders?: string[]; tmdbApiKey?: string }) {
    return this.fetch<CineClubResponse>('/cineclubs', { method: 'POST', body: JSON.stringify(data) });
  }

  getCineClubMembers(cineClubId: number) {
    return this.fetch<CineClubMemberResponse[]>(`/cineclubs/${cineClubId}/members`);
  }

  addCineClubMember(cineClubId: number, data: { userId: number; role: string; nasUsername?: string; nasPassword?: string }) {
    return this.fetch<CineClubMemberResponse>(`/cineclubs/${cineClubId}/members`, { method: 'POST', body: JSON.stringify(data) });
  }

  updateCineClubMember(cineClubId: number, userId: number, data: { role?: string; nasUsername?: string; nasPassword?: string }) {
    return this.fetch<CineClubMemberResponse>(`/cineclubs/${cineClubId}/members/${userId}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  removeCineClubMember(cineClubId: number, userId: number) {
    return this.fetch<void>(`/cineclubs/${cineClubId}/members/${userId}`, { method: 'DELETE' });
  }

  // Users
  getUsers() {
    return this.fetch<UserResponse[]>('/users');
  }

  createUser(data: { username: string; firstName: string; lastName: string; password: string; isSuperAdmin?: boolean }) {
    return this.fetch<UserResponse>('/users', { method: 'POST', body: JSON.stringify(data) });
  }

  updateUser(id: number, data: { username?: string; firstName?: string; lastName?: string; password?: string; isSuperAdmin?: boolean }) {
    return this.fetch<UserResponse>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  deleteUser(id: number) {
    return this.fetch<void>(`/users/${id}`, { method: 'DELETE' });
  }

  // Media
  getMedia(params?: { type?: MediaType; genreId?: number; year?: number; page?: number; limit?: number }) {
    const search = new URLSearchParams();
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) search.set(k, String(v)); });
    return this.fetch<PaginatedResponse<MediaResponse>>(`/media?${search}`);
  }

  getMediaById(id: number) {
    return this.fetch<MediaDetailResponse>(`/media/${id}`);
  }

  searchMedia(query: string, page = 1) {
    return this.fetch<PaginatedResponse<MediaResponse>>(`/media/search?q=${encodeURIComponent(query)}&page=${page}`);
  }

  getRecentMedia(limit = 20) {
    return this.fetch<MediaResponse[]>(`/media/recent?limit=${limit}`);
  }

  getMediaByQuality(quality: 'UHD' | 'HDR' | 'FHD', limit = 20) {
    return this.fetch<MediaResponse[]>(`/media/quality/${quality}?limit=${limit}`);
  }

  getAdminMedia(params?: { type?: MediaType; status?: SyncStatus; title?: string; videoQuality?: string; dolbyAtmos?: string; dolbyVision?: string; hdr?: string; sortBy?: string; sortOrder?: string; page?: number; limit?: number }) {
    const search = new URLSearchParams();
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') search.set(k, String(v)); });
    return this.fetch<PaginatedResponse<MediaResponse>>(`/media/admin/list?${search}`);
  }

  deleteMedia(id: number) {
    return this.fetch<void>(`/media/${id}`, { method: 'DELETE' });
  }

  updateMedia(id: number, data: Partial<Pick<MediaResponse, 'titleVf' | 'titleOriginal' | 'overview' | 'tmdbId' | 'releaseYear' | 'syncStatus' | 'type'>> & { syncError?: string | null }) {
    return this.fetch<MediaResponse>(`/media/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  getGenres() {
    return this.fetch<GenreResponse[]>('/media/genres');
  }

  getUnsynchronizedMedia(page = 1) {
    return this.fetch<PaginatedResponse<MediaResponse>>(`/media/unsynchronized?page=${page}`);
  }

  // Sync
  triggerFullSync() {
    return this.fetch<{ queued: number }>('/sync/full', { method: 'POST' });
  }

  syncSingleMedia(id: number) {
    return this.fetch<{ id: number; queued: boolean }>(`/sync/media/${id}`, { method: 'POST' });
  }

  enqueuePendingSync() {
    return this.fetch<{ message: string; queued: number }>('/sync/pending', { method: 'POST' });
  }

  drainQueue() {
    return this.fetch<{ cleaned: number }>('/sync/drain', { method: 'POST' });
  }

  getSyncLogs(page = 1) {
    return this.fetch<PaginatedResponse<SyncLogResponse>>(`/sync/logs?page=${page}`);
  }

  // NAS
  getNasStatus() {
    return this.fetch<{ online: boolean; lastCheckedAt: string }>('/nas/status');
  }

  wakeNas() {
    return this.fetch<{ sent: boolean; message: string }>('/nas/wake', { method: 'POST' });
  }

  getStreamUrl(mediaId: number, mode: StreamMode = 'stream') {
    return this.fetch<StreamUrlResponse>(`/nas/stream/${mediaId}?mode=${mode}&client=${detectClient()}`);
  }

  getEpisodeStreamUrl(episodeId: number, mode: StreamMode = 'stream') {
    return this.fetch<StreamUrlResponse>(`/nas/stream/episode/${episodeId}?mode=${mode}&client=${detectClient()}`);
  }

  // Health
  getHealth() {
    return this.fetch<HealthResponse>('/health');
  }

  // Jobs (super admin)
  listJobs(
    params: { kind?: JobKind; status?: JobStatus; source?: JobSource; page?: number; limit?: number } = {},
  ): Promise<{ items: JobResponse[]; total: number; page: number; limit: number }> {
    const qs = new URLSearchParams();
    if (params.kind) qs.set('kind', params.kind);
    if (params.status) qs.set('status', params.status);
    if (params.source) qs.set('source', params.source);
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    return this.fetch<{ items: JobResponse[]; total: number; page: number; limit: number }>(`/jobs${query ? `?${query}` : ''}`);
  }

  getJob(id: number): Promise<JobResponse> {
    return this.fetch<JobResponse>(`/jobs/${id}`);
  }

  listActiveJobs(): Promise<{ items: JobResponse[] }> {
    return this.fetch<{ items: JobResponse[] }>('/jobs/active');
  }

  cancelJob(id: number) {
    return this.fetch<{ id: number }>(`/jobs/${id}/cancel`, { method: 'POST' });
  }

  retryJob(id: number) {
    return this.fetch<{ id: number }>(`/jobs/${id}/retry`, { method: 'POST' });
  }

  deleteJob(id: number) {
    return this.fetch<{ deleted: boolean }>(`/jobs/${id}`, { method: 'DELETE' });
  }

  triggerManualTransfer(body: { mediaId?: number; jellyfinItemId?: string; tmdbId?: number; tmdbType?: 'movie' | 'tv'; sourcePath?: string; fileName?: string; fileSize?: number; seasonNumber?: number; episodeNumber?: number }) {
    return this.fetch<{ jobId: number }>('/jobs/transfer/manual', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  triggerJellyfinDelete(mediaId: number) {
    return this.fetch<{ jobId: number }>(`/jobs/delete-jellyfin/${mediaId}`, { method: 'POST' });
  }

  getRadarrLibrary() {
    return this.fetch<{ items: RadarrLibraryItem[] }>('/jobs/library/radarr');
  }

  getSonarrLibrary() {
    return this.fetch<{ items: SonarrLibraryItem[] }>('/jobs/library/sonarr');
  }
}

export const api = new ApiClient();
