import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type TeamGameChatDocument = TeamGameChat & Document;

@Schema({ timestamps: true })
export class TeamGameChat {
  @Prop({ required: true })
  gameId: string;

  @Prop({ required: true })
  message: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Team', required: true })
  teamId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  })
  organizationId: MongooseSchema.Types.ObjectId;
}
export const TeamGameChatSchema = SchemaFactory.createForClass(TeamGameChat);
