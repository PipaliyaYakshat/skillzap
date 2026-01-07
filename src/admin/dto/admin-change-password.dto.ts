import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { Match } from '../../users/decorators/match.decorator';

export class AdminChangePasswordDto {
  @ApiProperty({
    example: 'oldPassword123',
    description: 'Current password of the admin',
    required: true,
  })
  @IsString({ message: 'Old password must be a string' })
  oldPassword: string;

  @ApiProperty({
    example: 'newPassword123',
    description: 'New password for the admin',
    required: true,
  })
  @IsString({ message: 'New password must be a string' })
  @MinLength(6, { message: 'New password must be at least 6 characters long' })
  newPassword: string;

  @ApiProperty({
    example: 'newPassword123',
    description: 'Confirm new password (must match new password)',
    required: true,
  })
  @IsString({ message: 'Confirm password must be a string' })
  @Match('newPassword', {
    message: 'New password and confirm password must match',
  })
  confirmPassword: string;
}
