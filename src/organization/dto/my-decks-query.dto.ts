import { IsOptional, IsString, IsNumberString } from 'class-validator';

export class MyDecksQueryDto {
  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  name?: string;
}

