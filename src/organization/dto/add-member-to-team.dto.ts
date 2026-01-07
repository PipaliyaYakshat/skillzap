import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsArray,
  IsOptional,
} from 'class-validator';

export class AddMemberToTeamDto {
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
    description: 'Array of member emails to add',
    example: ['member1@example.com', 'member2@example.com'],
    type: [String],
  })
  @IsArray()
  @IsEmail({}, { each: true })
  @IsNotEmpty()
  memberEmails: string[];
}
