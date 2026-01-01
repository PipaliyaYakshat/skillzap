import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsEnum,
  IsPositive,
} from 'class-validator';
import { SubscriptionType } from '../entities/subscription-plan.entity';

export class CreateSubscriptionPlanDto {
  @ApiProperty({
    example: 'month',
    description: 'Subscription type: month, year, 14day, lives, or coins',
    enum: SubscriptionType,
  })
  @IsEnum(SubscriptionType, {
    message: 'subscriptionType must be one of: month, year, 14day, lives, coins',
  })
  @IsNotEmpty({ message: 'subscriptionType is required' })
  subscriptionType: SubscriptionType;

  @ApiProperty({
    example: 29.99,
    description: 'Subscription amount',
  })
  @IsNumber({}, { message: 'amount must be a number' })
  @IsPositive({ message: 'amount must be a positive number' })
  @IsNotEmpty({ message: 'amount is required' })
  amount: number;

  @ApiProperty({
    example: 'USD',
    description: 'Currency code (e.g., USD, EUR, GBP)',
  })
  @IsString({ message: 'currency must be a string' })
  @IsNotEmpty({ message: 'currency is required' })
  currency: string;

  @ApiProperty({
    example: 'Basic Monthly Plan',
    description: 'Name of the subscription plan',
  })
  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name is required' })
  name: string;
}

