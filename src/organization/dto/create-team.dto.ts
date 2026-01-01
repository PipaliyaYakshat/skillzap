import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsEmail, IsArray } from 'class-validator';

export class CreateTeamDto {
  @ApiProperty({
    description: 'Organization ID (optional - will be derived from admin/superAdmin user if not provided)',
    example: '69366f002af838888b16b0c9',
    required: false,
  })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiProperty({
    description: 'Team name',
    example: 'Development Team',
  })
  @IsString()
  @IsNotEmpty()
  teamName: string;

  @ApiProperty({
    description: 'Optional array of member emails to add immediately',
    example: ['member1@example.com', 'member2@example.com'],
    required: false,
    type: [String],
  })
  @IsArray()
  @IsEmail({}, { each: true })
  @IsOptional()
  memberEmails?: string[];
}

