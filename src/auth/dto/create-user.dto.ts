import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  Matches,
  IsNumber,
} from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'John', description: 'User first name', required: false, nullable: true })
  @IsOptional()
  @IsString({ message: 'First name must be a string' })
  name?: string | null;

  @ApiProperty({ example: 'john@example.com', description: 'User email' })
  @IsEmail({}, { message: 'Please provide a valid email' })
  @IsNotEmpty({ message: 'Email is required' })
  email: string;

  @ApiProperty({
    example: 'Pass@123',
    description: 'Password (min 6 characters)',
  })
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password: string;

  @ApiProperty({
    example: '9876543210',
    description: '10-digit phone number',
  })
  @IsString({ message: 'Phone number must be a string' })
  @Matches(/^\d{10}$/, { message: 'Phone number must be exactly 10 digits' })
  contactNumber: string;

  @ApiProperty({
    example: '+91',
    description: 'Country calling code (e.g. +91, +1)',
  })
  @IsOptional()
  @IsString({ message: 'Country code must be a string' })
  @Matches(/^\+[1-9]\d{0,3}$/, { message: 'Invalid country code format' })
  countryCode: string;

  @ApiProperty({
    example: 1,
    description: 'Month of birth',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  monthOfBirth?: number | null;

  @ApiProperty({
    example: 1990,
    description: 'Year of birth',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  yearOfBirth?: number | null;
}
