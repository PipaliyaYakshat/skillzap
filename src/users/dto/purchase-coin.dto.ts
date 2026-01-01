import { IsMongoId, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PurchaseCoinDto {
    @ApiProperty({
        description: 'Mongo identifier of the subscription plan to be purchased',
        example: '69366dfd654604983bbdeada',
    })
    @IsMongoId()
    @IsNotEmpty()
    subscriptionPlanId: string;

    @ApiProperty({
        description: 'Government-issued Card number used for invoicing',
        example: '121234345656',
    })
    @IsString()
    @IsNotEmpty()
    @MaxLength(20)
    cardNumber: string;
}

