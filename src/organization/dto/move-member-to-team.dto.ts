import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class MoveMemberToTeamDto {
  @ApiProperty({
    description: 'Current Team ID (source team)',
    example: '507f1f77bcf86cd799439011',
  })
  @IsString()
  @IsNotEmpty()
  teamId: string;

  @ApiProperty({
    description: 'Team Member ID (the ID of the team member record to move)',
    example: '507f1f77bcf86cd799439011',
  })
  @IsString()
  @IsNotEmpty()
  memberId: string;

  @ApiProperty({
    description: 'Destination Team ID (target team to move member to)',
    example: '507f1f77bcf86cd799439012',
  })
  @IsString()
  @IsNotEmpty()
  moveTeamId: string;
}

