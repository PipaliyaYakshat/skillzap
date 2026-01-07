import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type TeamDocument = Team & Document;

@Schema()
export class Team extends Document {
  @Prop({ required: true })
  teamName: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  creator: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  })
  organization: MongooseSchema.Types.ObjectId;

  @Prop({ default: false })
  isActive: boolean;

  // Cumulative points earned from team game wins
  @Prop({ default: 0 })
  points: number;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: 0 })
  memberCount: number;
}

export const TeamSchema = SchemaFactory.createForClass(Team);
