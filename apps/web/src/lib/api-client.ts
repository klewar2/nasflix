import type { PaginatedResponse, AuthTokens, HealthResponse, LoginResponse, UserResponse, CineClubResponse, CineClubMemberResponse } from '@nasflix/shared';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

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

  // CineClubs
  getCineClubs() {
    return this.fetch<CineClubResponse[]>('/cineclubs');
  }

  getCineClub(id: number) {
    return this.fetch<CineClubResponse>(`/cineclubs/${id}`);
  }

  updateCineClub(id: number, data: Partial<Pick<CineClubResponse, 'name' | 'nasBaseUrl' | 'nasSharedFolders' | 'tmdbApiKey' | 'nasWolMac' | 'nasWolHost' | 'nasWolPort' | 'freeboxApiUrl'>>) {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMedia(params?: { type?: string; genreId?: number; year?: number; page?: number; limit?: number }): Promise<PaginatedResponse<any>> {
    const search = new URLSearchParams();
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) search.set(k, String(v)); });
    return this.fetch<PaginatedResponse<any>>(`/media?${search}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMediaById(id: number): Promise<any> {
    return this.fetch<any>(`/media/${id}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  searchMedia(query: string, page = 1): Promise<PaginatedResponse<any>> {
    return this.fetch<PaginatedResponse<any>>(`/media/search?q=${encodeURIComponent(query)}&page=${page}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getRecentMedia(limit = 20): Promise<any[]> {
    return this.fetch<any[]>(`/media/recent?limit=${limit}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMediaByQuality(quality: 'UHD' | 'HDR' | 'FHD', limit = 20): Promise<any[]> {
    return this.fetch<any[]>(`/media/quality/${quality}?limit=${limit}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAdminMedia(params?: { type?: string; status?: string; title?: string; videoQuality?: string; dolbyAtmos?: string; dolbyVision?: string; hdr?: string; sortBy?: string; sortOrder?: string; page?: number; limit?: number }): Promise<any> {
    const search = new URLSearchParams();
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') search.set(k, String(v)); });
    return this.fetch<any>(`/media/admin/list?${search}`);
  }

  deleteMedia(id: number) {
    return this.fetch<void>(`/media/${id}`, { method: 'DELETE' });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateMedia(id: number, data: any): Promise<any> {
    return this.fetch<any>(`/media/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getGenres(): Promise<any[]> {
    return this.fetch<any[]>('/media/genres');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getUnsynchronizedMedia(page = 1): Promise<PaginatedResponse<any>> {
    return this.fetch<PaginatedResponse<any>>(`/media/unsynchronized?page=${page}`);
  }

  // Sync
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  triggerFullSync(): Promise<any> {
    return this.fetch<any>('/sync/full', { method: 'POST' });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  syncSingleMedia(id: number): Promise<any> {
    return this.fetch<any>(`/sync/media/${id}`, { method: 'POST' });
  }

  enqueuePendingSync() {
    return this.fetch<{ message: string; queued: number }>('/sync/pending', { method: 'POST' });
  }

  drainQueue() {
    return this.fetch<{ cleaned: number }>('/sync/drain', { method: 'POST' });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSyncLogs(page = 1): Promise<PaginatedResponse<any>> {
    return this.fetch<PaginatedResponse<any>>(`/sync/logs?page=${page}`);
  }

  // NAS
  getNasStatus() {
    return this.fetch<{ online: boolean; lastCheckedAt: string }>('/nas/status');
  }

  wakeNas() {
    return this.fetch<{ sent: boolean; message: string }>('/nas/wake', { method: 'POST' });
  }

  getStreamUrl(mediaId: number, mode: 'stream' | 'download' = 'stream') {
    return this.fetch<{ url: string; isHls: boolean; durationSeconds: number }>(`/nas/stream/${mediaId}?mode=${mode}`);
  }

  getEpisodeStreamUrl(episodeId: number, mode: 'stream' | 'download' = 'stream') {
    return this.fetch<{ url: string; isHls: boolean; durationSeconds: number }>(`/nas/stream/episode/${episodeId}?mode=${mode}`);
  }

  // Health
  getHealth() {
    return this.fetch<HealthResponse>('/health');
  }
}

export const api = new ApiClient();
