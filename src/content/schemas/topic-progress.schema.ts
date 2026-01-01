import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TopicProgressDocument = TopicProgress & Document;

@Schema({ timestamps: true })
export class TopicProgress {
  @Prop({ required: true })
  topicId: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ type: [String], default: [] })
  completedSubTopicIds: string[];

  @Prop({ default: 0 })
  completedCycles: number;

  @Prop({ type: Date })
  lastCycleCompletedAt?: Date;
}

export const TopicProgressSchema = SchemaFactory.createForClass(TopicProgress);

TopicProgressSchema.index(
  { topicId: 1, userId: 1 },
  {
    unique: true,
  },
);
