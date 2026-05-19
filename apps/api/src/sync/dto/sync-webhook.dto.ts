import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class MovedPathDto {
  @IsString() from: string;
  @IsString() to: string;
}

export class SyncWebhookDto {
  @IsOptional() @IsString() trigger?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  added?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  removed?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MovedPathDto)
  moved?: MovedPathDto[];
}
