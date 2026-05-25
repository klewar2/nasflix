export interface NasConfigResponse {
  id: number;
  name: string;
  baseUrl: string;
  username: string;
  sharedFolders: string[];
  isActive: boolean;
  lastOnlineAt: string | null;
  lastSyncAt: string | null;
}

export interface NasFileResponse {
  path: string;
  name: string;
  size: number;
  isDir: boolean;
  modifiedAt: string;
}

export interface NasStatusResponse {
  online: boolean;
  lastCheckedAt: string;
  baseUrl?: string;
  // État persistant du Wake-on-LAN
  wakeInProgress: boolean;
  wakeStartedAt: string | null;
  wakeStartedByUserId: number | null;
  wakeTimeoutSeconds: number;
}
