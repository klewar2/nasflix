import { IsInt, IsOptional, IsString } from 'class-validator';

export class ManualTransferDto {
  @IsOptional()
  @IsInt()
  mediaId?: number;

  @IsOptional()
  @IsString()
  jellyfinItemId?: string;

  @IsOptional()
  @IsInt()
  tmdbId?: number;

  @IsOptional()
  @IsString()
  tmdbType?: 'movie' | 'tv';

  @IsOptional()
  @IsString()
  sourcePath?: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsInt()
  seasonNumber?: number;

  @IsOptional()
  @IsInt()
  episodeNumber?: number;

  @IsOptional()
  fileSize?: number;
}
