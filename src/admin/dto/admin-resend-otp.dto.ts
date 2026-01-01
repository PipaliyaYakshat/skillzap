import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class AdminResendOtpDto {
  @ApiProperty({
    example: 'admin@example.com',
    description: 'Admin email to resend OTP',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

