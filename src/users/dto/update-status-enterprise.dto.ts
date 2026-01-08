import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsEnum,
  IsOptional,
  IsMongoId,
} from 'class-validator';
import { STATUS_UPDATE, EnterpriseStatus } from 'src/common/enum';

export class UpdateStatusEnterpriseDto {
  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'Registration ID from ContentFileData',
  })
  @IsNotEmpty({ message: 'Registration ID is required' })
  @IsMongoId({ message: 'Invalid registration ID format' })
  @IsString({ message: 'Registration ID must be a string' })
  registrationId: string;

  @ApiProperty({
    example: STATUS_UPDATE[1],
    enum: EnterpriseStatus,
    description: 'Status to update: approve or reject',
  })
  @IsNotEmpty({ message: 'Status is required' })
  @IsEnum(EnterpriseStatus, {
    message: 'Status must be either "approve" or "reject"',
  })
  status: EnterpriseStatus;

  @ApiProperty({
    example: '694fabd16aa5ed8993a8acc1',
    description: 'Subscription Plan ID (optional, only when status is approve)',
    required: false,
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid subscription plan ID format' })
  @IsString({ message: 'Subscription plan ID must be a string' })
  subscriptionPlanId?: string;
}
