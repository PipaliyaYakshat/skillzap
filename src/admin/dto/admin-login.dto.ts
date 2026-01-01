import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class AdminLoginDto {
  @ApiProperty({ example: 'admin@example.com', description: 'Admin email' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'Pass@123', description: 'Admin password' })
  @IsString()
  @MinLength(6)
  @IsNotEmpty()
  password: string;
}

