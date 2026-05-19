import { IsOptional, IsString, IsUrl } from 'class-validator';

export class SaveFreeboxTokenDto {
  @IsUrl({ require_tld: false, require_protocol: true })
  freeboxApiUrl: string;

  @IsString()
  appToken: string;
}

export class StartFreeboxAuthorizationDto {
  @IsUrl({ require_tld: false, require_protocol: true })
  freeboxApiUrl: string;
}

export class SaveJellyfinConfigDto {
  @IsUrl({ require_tld: false, require_protocol: true })
  jellyfinBaseUrl: string;

  @IsString()
  jellyfinApiToken: string;
}

export class UpdateUserPreferencesDto {
  @IsOptional()
  @IsString()
  streamingQuality?: 'LOW' | 'MEDIUM' | 'HIGH' | 'NATIVE';
}
