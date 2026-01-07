import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum SubscriptionType {
  MONTH = 'month',
  YEAR = 'year',
  FOURTEEN_DAY = '14day',
  LIVES = 'lives',
  COINS = 'coins',
}

@Schema({ timestamps: true })
export class SubscriptionPlan {
  @Prop({
    type: String,
    enum: Object.values(SubscriptionType),
    required: true,
  })
  subscriptionType: SubscriptionType;

  @Prop({ type: Number, required: true })
  amount: number;

  @Prop({ type: String, required: true })
  currency: string;

  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: Boolean, default: false })
  isDeleted: boolean;
}

export type SubscriptionPlanDocument = SubscriptionPlan & Document;
export const SubscriptionPlanSchema =
  SchemaFactory.createForClass(SubscriptionPlan);
