import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class GetTeamMembersDto {
  @ApiProperty({
    description: 'Team ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsString()
  @IsNotEmpty()
  teamId: string;

  @ApiProperty({
    description: 'Organization ID',
    example: '69366f002af838888b16b0c9',
  })
  @IsString()
  @IsNotEmpty()
  organizationId: string;
}
