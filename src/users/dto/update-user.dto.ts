import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEmail, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateUserDto {
  @ApiProperty({
    example: 'John Doe',
    description: 'User name',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Name must be a string' })
  name?: string;

  @ApiProperty({
    example: 'john@example.com',
    description: 'User email',
    required: false,
  })
  @IsOptional()
  @IsEmail({}, { message: 'Please provide a valid email' })
  email?: string;

  @ApiProperty({
    type: String,
    format: 'binary',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Profile image must be a string' })
  profileImage?: string;

  @ApiProperty({
    example: ['avatar1', 'avatar2'],
    description: 'List of avatar ids for the user',
    required: false,
    isArray: true,
    type: String,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    // Accept single string, comma separated, JSON array, or array input
    if (Array.isArray(value)) {
      return value.map(String);
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed.map(String);
        }
      } catch {
        /* fall through */
      }
      // handle comma separated values
      return value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    }
    return [String(value)];
  })
  @IsArray({ message: 'Avatar id must be an array' })
  @IsString({ each: true, message: 'Each avatar id must be a string' })
  avatarId?: string[];

  @ApiProperty({
    example: ['purchased1', 'purchased2'],
    description: 'List of purchased avatar ids',
    required: false,
    isArray: true,
    type: String,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    if (Array.isArray(value)) {
      return value.map(String);
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed.map(String);
        }
      } catch {
        /* fall through */
      }
      return value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    }
    return [String(value)];
  })
  @IsArray({ message: 'Purchased avatars must be an array' })
  @IsString({
    each: true,
    message: 'Each purchased avatar id must be a string',
  })
  purchasedAvatars?: string[];
}
