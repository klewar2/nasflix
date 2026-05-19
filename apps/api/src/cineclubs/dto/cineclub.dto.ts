import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { MemberRole } from '@prisma/client';

export class CreateCineClubDto {
  @IsString()
  name: string;

  @IsString()
  slug: string;

  @IsOptional()
  @IsString()
  nasBaseUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  nasSharedFolders?: string[];

  @IsOptional()
  @IsString()
  tmdbApiKey?: string;
}

export class UpdateCineClubDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() nasBaseUrl?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) nasSharedFolders?: string[];
  @IsOptional() @IsString() tmdbApiKey?: string | null;

  @IsOptional() @IsString() nasWolMac?: string | null;
  @IsOptional() @IsString() nasWolHost?: string | null;
  @IsOptional() @IsInt() nasWolPort?: number | null;
  @IsOptional() @IsInt() nasWolWaitSeconds?: number;

  @IsOptional() @IsString() freeboxApiUrl?: string | null;

  @IsOptional() @IsString() radarrBaseUrl?: string | null;
  @IsOptional() @IsString() radarrApiKey?: string | null;
  @IsOptional() @IsString() sonarrBaseUrl?: string | null;
  @IsOptional() @IsString() sonarrApiKey?: string | null;

  @IsOptional() @IsString() seedboxSshHost?: string | null;
  @IsOptional() @IsInt() seedboxSshPort?: number;
  @IsOptional() @IsString() seedboxSshUser?: string | null;
  @IsOptional() @IsString() seedboxSshPrivateKey?: string | null;
  @IsOptional() @IsString() seedboxSshPassphrase?: string | null;

  @IsOptional() @IsString() nasSshHost?: string | null;
  @IsOptional() @IsInt() nasSshPort?: number;
  @IsOptional() @IsString() nasSshUser?: string | null;
  @IsOptional() @IsString() seedboxToNasKeyPath?: string | null;

  @IsOptional() @IsString() nasTargetMovieDir?: string | null;
  @IsOptional() @IsString() nasTargetSeriesDir?: string | null;
  @IsOptional() @IsInt() seedboxDeleteGraceHours?: number;

  @IsOptional() @IsString() gmailFrom?: string | null;
  @IsOptional() @IsString() gmailAppPassword?: string | null;
  @IsOptional() @IsBoolean() gmailEnabled?: boolean;
}

export class AddMemberDto {
  @IsInt()
  userId: number;

  @IsEnum(MemberRole)
  role: MemberRole;

  @IsOptional() @IsString() nasUsername?: string;
  @IsOptional() @IsString() nasPassword?: string;
}

export class UpdateMemberDto {
  @IsOptional() @IsEnum(MemberRole) role?: MemberRole;
  @IsOptional() @IsString() nasUsername?: string;
  @IsOptional() @IsString() nasPassword?: string;
}
