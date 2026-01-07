import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsMongoId } from 'class-validator';

export class RemoveAdminDto {
  @ApiProperty({
    example: '693124a103549437b9f1adb0',
    description: 'MongoDB ObjectId of the admin user to be removed',
  })
  @IsString({ message: 'Admin user ID must be a string' })
  @IsMongoId({ message: 'Admin user ID must be a valid MongoDB ObjectId' })
  @IsNotEmpty({ message: 'Admin user ID is required' })
  adminUserId: string;

  @ApiProperty({
    example: '69366f002af838888b16b0c9',
    description: 'MongoDB ObjectId of the organization',
  })
  @IsString({ message: 'Organization ID must be a string' })
  @IsMongoId({ message: 'Organization ID must be a valid MongoDB ObjectId' })
  @IsNotEmpty({ message: 'Organization ID is required' })
  organizationId: string;
}
