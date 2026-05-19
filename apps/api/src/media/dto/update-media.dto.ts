import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { MediaType, SyncStatus } from '@prisma/client';

export class UpdateMediaDto {
  @IsOptional() @IsString() titleVf?: string;
  @IsOptional() @IsString() titleOriginal?: string;
  @IsOptional() @IsString() overview?: string;
  @IsOptional() @IsInt() tmdbId?: number;
  @IsOptional() @IsInt() releaseYear?: number;
  @IsOptional() @IsEnum(SyncStatus) syncStatus?: SyncStatus;
  @IsOptional() @IsString() syncError?: string | null;
  @IsOptional() @IsEnum(MediaType) type?: MediaType;
}
