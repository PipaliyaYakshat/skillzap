import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class CreateEnterpriseUserDto {
  @ApiProperty({ example: 'John', description: 'User first name' })
  @IsString({ message: 'First name must be a string' })
  @IsNotEmpty({ message: 'First name is required' })
  firstName: string;

  @ApiProperty({ example: 'Doe', description: 'User last name' })
  @IsString({ message: 'Last name must be a string' })
  @IsNotEmpty({ message: 'Last name is required' })
  lastName: string;

  @ApiProperty({ example: 'john@example.com', description: 'User email' })
  @IsEmail({}, { message: 'Please provide a valid email' })
  @IsNotEmpty({ message: 'Email is required' })
  email: string;

  @ApiProperty({
    example: '9876543210',
    description: 'Contact number',
  })
  @IsString({ message: 'Contact number must be a string' })
  @IsNotEmpty({ message: 'Contact number is required' })
  contactNumber: string;

  @ApiProperty({
    example: 'Acme Corporation',
    description: 'Organization name',
  })
  @IsString({ message: 'Organization name must be a string' })
  @IsNotEmpty({ message: 'Organization name is required' })
  organizationName: string;

  @ApiProperty({
    example: 'New York',
    description: 'City',
  })
  @IsString({ message: 'City must be a string' })
  @IsNotEmpty({ message: 'City is required' })
  city: string;

  @ApiProperty({
    example: 'USA',
    description: 'Country',
  })
  @IsString({ message: 'Country must be a string' })
  @IsNotEmpty({ message: 'Country is required' })
  country: string;

  @ApiProperty({
    example: 'We are a leading technology company...',
    description: 'About us information',
  })
  @IsString({ message: 'About us must be a string' })
  @IsNotEmpty({ message: 'About us is required' })
  aboutUs: string;

  @ApiProperty({
    example: '+91',
    description: 'Country calling code (e.g. +91, +1)',
  })
  @IsOptional()
  @IsString({ message: 'Country code must be a string' })
  @Matches(/^\+[1-9]\d{0,3}$/, { message: 'Invalid country code format' })
  countryCode?: string;
}

