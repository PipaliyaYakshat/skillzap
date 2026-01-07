import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type TeamMemberDocument = TeamMember & Document;

@Schema()
export class TeamMember extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Team', required: true })
  team: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: false })
  user: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  })
  organization: MongooseSchema.Types.ObjectId;

  @Prop({ required: false })
  email: string;

  @Prop({ default: false })
  isAdmin: boolean;

  @Prop({ default: 'pending' })
  status: string;

  @Prop({ default: Date.now })
  joinedAt: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: false })
  creator: MongooseSchema.Types.ObjectId;

  @Prop({ type: Number, default: 0 })
  flashcardAccuracy: number;

  @Prop({ type: Number, default: 0 })
  battleAccuracy: number;

  @Prop({ type: Number, default: 0 })
  gameAccuracy: number;
}

export const TeamMemberSchema = SchemaFactory.createForClass(TeamMember);
