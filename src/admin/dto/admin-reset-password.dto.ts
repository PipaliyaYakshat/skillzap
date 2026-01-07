import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class AdminResetPasswordDto {
  @ApiProperty({
    example: 'admin@example.com',
    description: 'Registered admin email for the password reset request',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'Abcd@123', description: 'New password' })
  @IsString()
  @MinLength(6)
  @IsNotEmpty()
  password: string;

  @ApiProperty({ example: 'Abcd@123', description: 'Confirm new password' })
  @IsString()
  @MinLength(6)
  @IsNotEmpty()
  confirmPassword: string;
}
