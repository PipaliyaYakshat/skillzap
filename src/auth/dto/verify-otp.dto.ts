import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({ example: 'john@example.com', description: 'User email' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: '111111', description: 'OTP code' })
  @IsString()
  @Length(4, 6, { message: 'OTP must be between 4 to 6 digits' })
  @IsNotEmpty()
  otp: string;
}
