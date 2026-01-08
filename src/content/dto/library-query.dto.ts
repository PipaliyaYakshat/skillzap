import { IsOptional, IsString, IsEnum, IsNumberString } from 'class-validator';
import { LibraryFilter } from 'src/common/enum';

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
