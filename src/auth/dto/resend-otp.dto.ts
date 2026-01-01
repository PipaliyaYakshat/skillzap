import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class ResendOtpDto {
  @ApiProperty({
    example: 'john@example.com',
    description: 'Email to resend OTP',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}
