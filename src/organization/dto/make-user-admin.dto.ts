import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, IsMongoId, IsOptional } from 'class-validator';

export class MakeUserAdminDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email of the user to be made admin',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  email: string;

  @ApiProperty({
    example: '69366f002af838888b16b0c9',
    description: 'MongoDB ObjectId of the organization (optional - will be derived from admin user if not provided)',
    required: false,
  })
  @IsOptional()
  @IsMongoId({ message: 'Organization ID must be a valid MongoDB ObjectId' })
  organizationId?: string;

  @ApiProperty({
    example: 'John Doe',
    description: 'Name of the user to be made admin',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Name must be a string' })
  name?: string;
}

