import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsMongoId } from 'class-validator';

export class UpdateUserTypeDto {
  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'User ID',
  })
  @IsNotEmpty({ message: 'User ID is required' })
  @IsMongoId({ message: 'Invalid user ID format' })
  @IsString({ message: 'User ID must be a string' })
  userId: string;

  @ApiProperty({
    example: 'Individual',
    description: 'User type (e.g., Individual, superAdmin, member)',
  })
  @IsNotEmpty({ message: 'User type is required' })
  @IsString({ message: 'User type must be a string' })
  userType: string;
}
