import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsMongoId } from 'class-validator';

export class DeleteDeckByIdDto {
  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'Deck ID',
  })
  @IsNotEmpty({ message: 'Deck ID is required' })
  @IsMongoId({ message: 'Invalid deck ID format' })
  @IsString({ message: 'Deck ID must be a string' })
  deckId: string;
}

