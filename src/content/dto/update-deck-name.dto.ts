import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class UpdateDeckNameDto {
  @ApiProperty({
    description: 'New name for the deck',
    example: 'Updated Deck Name',
    minLength: 1,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  name: string;
}

