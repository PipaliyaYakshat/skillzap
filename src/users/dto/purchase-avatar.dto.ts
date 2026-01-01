import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class PurchaseAvatarDto {
  @ApiProperty({
    description: 'Identifier of the avatar being purchased',
    example: 'purchased-avatar-01',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  avatarId: string;
}

