import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class UpdateOrganizationDto {
  @ApiProperty({
    example: 'Updated Organization Name',
    description: 'Name of the organization',
    required: false,
  })
  @IsString({ message: 'Organization name must be a string' })
  @IsOptional()
  organizationName?: string;
}
