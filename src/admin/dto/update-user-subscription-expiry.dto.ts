import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsMongoId, IsDateString } from 'class-validator';

export class UpdateUserSubscriptionExpiryDto {
  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'User ID',
  })
  @IsNotEmpty({ message: 'User ID is required' })
  @IsMongoId({ message: 'Invalid user ID format' })
  @IsString({ message: 'User ID must be a string' })
  userId: string;

  @ApiProperty({
    example: '2024-12-31T23:59:59.000Z',
    description: 'Subscription expiry date',
  })
  @IsNotEmpty({ message: 'Expiry date is required' })
  @IsDateString({}, { message: 'Expiry date must be a valid date string' })
  expiryDate: string;
}
