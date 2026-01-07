import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TopicDocument = Topic & Document;

@Schema({ timestamps: true })
export class Topic {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({ type: [String], default: [] })
  subTopics: string[];

  @Prop({ type: [String], default: [] })
  contentIds: string[];

  @Prop({ type: Object })
  metadata: Record<string, any>;

  @Prop({ type: Map, of: Number, default: {} })
  userPercentages: Map<string, number>;

  // Store per-user flashcard accuracy percentages for this topic (aggregated from all subtopics)
  // Formula: (acc1 + acc2 + ... + accN) / N
  @Prop({
    type: [
      {
        userId: { type: String, required: true },
        accuracy: { type: Number, default: 0 },
        gamesPlayed: { type: Number, default: 0 },
      },
    ],
    default: [],
  })
  flashcardAccuracies: {
    userId: string;
    accuracy: number;
    gamesPlayed: number;
  }[];

  // Store per-user battle accuracy percentages for this topic (no subtopicId)
  @Prop({
    type: [
      {
        userId: { type: String, required: true },
        accuracy: { type: Number, default: 0 },
        gamesPlayed: { type: Number, default: 0 },
      },
    ],
    default: [],
  })
  battleAccuracies: { userId: string; accuracy: number; gamesPlayed: number }[];

  @Prop({
    type: [
      {
        userId: { type: String, required: false },
        deviceId: { type: String, required: false },
        details: { type: String, required: true },
        generatedAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  details: {
    userId?: string;
    deviceId?: string;
    details: string;
    generatedAt: Date;
  }[];

  @Prop({
    type: [
      {
        question: String,
        answer: String,
        userId: String,
        deviceId: String,
        askedAt: Date,
      },
    ],
    default: [],
  })
  questions?: {
    question: string;
    answer: string;
    userId?: string;
    deviceId?: string;
    askedAt: Date;
  }[];

  // @Prop({ type: Number, default: 0 ,required: false})
  // percentage: number;
}

export const TopicSchema = SchemaFactory.createForClass(Topic);
