export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiError {
  statusCode: number;
  message: string;
  error?: string;
}

export interface HealthResponse {
  status: 'ok' | 'error';
  nas: 'online' | 'offline' | 'unknown';
  db: 'ok' | 'error';
  timestamp: string;
}

export interface SyncLogResponse {
  id: number;
  type: string;
  status: string;
  totalItems: number | null;
  processedItems: number | null;
  errorCount: number | null;
  startedAt: string;
  completedAt: string | null;
  triggeredBy: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
