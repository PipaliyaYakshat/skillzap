import { IsArray, IsNotEmpty, IsString, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MoveTopicsDto {
  @ApiProperty({
    description: 'Array of topic IDs to move',
    example: ['67501b23842d45d1c3d9f91a', '67501b23842d45d1c3d9f91b'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one topic ID is required' })
  @IsString({ each: true })
  topicIds: string[];

  @ApiProperty({
    description: 'Destination deck ID where topics will be moved',
    example: '67501b23842d45d1c3d9f91c',
  })
  @IsNotEmpty({ message: 'deckId is required' })
  @IsString()
  deckId: string;
}
