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

export interface UserResponse {
  id: number;
  username: string;
  firstName: string;
  lastName: string;
  isSuperAdmin: boolean;
  lastLoginAt: string | null;
}

export interface CineClubResponse {
  id: number;
  name: string;
  slug: string;
  nasBaseUrl: string | null;
  nasSharedFolders: string[];
  tmdbApiKey: string | null;
  webhookSecretSet: boolean;
  nasWolMac: string | null;
  nasWolHost: string | null;
  nasWolPort: number | null;
  freeboxApiUrl: string | null;
  freeboxAppTokenSet: boolean;
  lastOnlineAt: string | null;
  lastSyncAt: string | null;
  role?: 'ADMIN' | 'VIEWER';
}

export interface CineClubMemberResponse {
  id: number;
  role: 'ADMIN' | 'VIEWER';
  nasUsername: string | null;
  user: {
    id: number;
    username: string;
    firstName: string;
    lastName: string;
    lastLoginAt: string | null;
  };
}

export interface LoginResponse extends AuthTokens {
  user: UserResponse;
}
