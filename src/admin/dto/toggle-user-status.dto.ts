import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsBoolean, IsMongoId, IsString } from 'class-validator';

export class ToggleUserStatusDto {
  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'User ID',
  })
  @IsNotEmpty({ message: 'User ID is required' })
  @IsMongoId({ message: 'Invalid user ID format' })
  @IsString({ message: 'User ID must be a string' })
  userId: string;

  @ApiProperty({
    example: true,
    description: 'Block status (true = blocked, false = unblocked)',
  })
  @IsNotEmpty({ message: 'isBlocked is required' })
  @IsBoolean({ message: 'isBlocked must be a boolean' })
  isBlocked: boolean;
}
