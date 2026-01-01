import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class AdminForgotPasswordDto {
  @ApiProperty({
    example: 'admin@example.com',
    description: 'Admin email to receive password reset OTP',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

