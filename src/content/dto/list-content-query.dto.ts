import { IsOptional, IsString } from 'class-validator';

export class ListContentQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsString()
  deckId?: string;

  @IsOptional()
  @IsString()
  contentType?: string;
}
