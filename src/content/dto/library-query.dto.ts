import { IsOptional, IsString, IsEnum, IsNumberString } from 'class-validator';

export enum LibraryFilter {
  PRIVATE = 'private',
  PUBLIC = 'public',
}

export class LibraryQueryDto {
  @IsOptional()
  @IsEnum(LibraryFilter)
  filter?: LibraryFilter;

  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;

  @IsOptional()
  @IsString()
  category?: string;
}
