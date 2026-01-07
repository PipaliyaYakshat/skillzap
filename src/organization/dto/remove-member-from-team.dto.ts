import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class RemoveMemberFromTeamDto {
  @ApiProperty({
    description: 'Team ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsString()
  @IsNotEmpty()
  teamId: string;

  @ApiProperty({
    description:
      'Organization ID (optional - will be derived from admin/superAdmin user if not provided)',
    example: '69366f002af838888b16b0c9',
    required: false,
  })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiProperty({
    description: 'Team Member ID (the ID of the team member record to remove)',
    example: '507f1f77bcf86cd799439011',
  })
  @IsString()
  @IsNotEmpty()
  memberId: string;
}
