import type { PaginatedResponse, AuthTokens, HealthResponse } from '@nasflix/shared';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

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

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      this.accessToken = null;
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
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
  }

  isAuthenticated() {
    return !!this.accessToken;
  }

  // Auth
  login(username: string, password: string) {
    return this.fetch<AuthTokens>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  // Media
  getMedia(params?: { type?: string; genreId?: number; year?: number; page?: number; limit?: number }) {
    const search = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined) search.set(k, String(v));
      });
    }
    return this.fetch<PaginatedResponse<any>>(`/media?${search}`);
  }

  getMediaById(id: number) {
    return this.fetch<any>(`/media/${id}`);
  }

  searchMedia(query: string, page = 1) {
    return this.fetch<PaginatedResponse<any>>(`/media/search?q=${encodeURIComponent(query)}&page=${page}`);
  }

  getRecentMedia(limit = 20) {
    return this.fetch<any[]>(`/media/recent?limit=${limit}`);
  }

  getUnsynchronizedMedia(page = 1) {
    return this.fetch<PaginatedResponse<any>>(`/media/unsynchronized?page=${page}`);
  }

  getGenres() {
    return this.fetch<any[]>('/media/genres');
  }

  deleteMedia(id: number) {
    return this.fetch<void>(`/media/${id}`, { method: 'DELETE' });
  }

  updateMedia(id: number, data: any) {
    return this.fetch<any>(`/media/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  // Health
  getHealth() {
    return this.fetch<HealthResponse>('/health');
  }

  // NAS
  getNasStatus() {
    return this.fetch<{ online: boolean; lastCheckedAt: string }>('/nas/status');
  }

  getNasConfig() {
    return this.fetch<any>('/nas/config');
  }

  updateNasConfig(data: any) {
    return this.fetch<any>('/nas/config', { method: 'PUT', body: JSON.stringify(data) });
  }

  // Sync
  triggerFullSync() {
    return this.fetch<any>('/sync/full', { method: 'POST' });
  }

  syncSingleMedia(id: number) {
    return this.fetch<any>(`/sync/media/${id}`, { method: 'POST' });
  }

  getSyncLogs(page = 1) {
    return this.fetch<PaginatedResponse<any>>(`/sync/logs?page=${page}`);
  }

  // Metadata
  searchTmdb(query: string) {
    return this.fetch<any[]>(`/metadata/search?q=${encodeURIComponent(query)}`);
  }

  getApiConfigs() {
    return this.fetch<any[]>('/metadata/config');
  }

  updateApiConfig(data: { provider: string; apiKey: string }) {
    return this.fetch<any>('/metadata/config', { method: 'PUT', body: JSON.stringify(data) });
  }
}

export const api = new ApiClient();
