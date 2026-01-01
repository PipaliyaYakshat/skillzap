import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({
    example: 'john@example.com',
    description: 'Email to receive password reset OTP',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}
