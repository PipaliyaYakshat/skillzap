import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SubTopicDocument = SubTopic & Document;

@Schema({ timestamps: true })
export class SubTopic {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  topicId: string;

  @Prop({ type: [String], default: [] })
  contentIds: string[];

  @Prop({ type: Object })
  metadata: Record<string, any>;

  @Prop({ type: [Object], default: [] })
  questions: Array<{
    question: string;
    answer: string;
    difficulty: 'easy' | 'medium' | 'hard';
  }>;

  @Prop({
    type: [
      {
        question: { type: String, required: false },
        answer: { type: String, required: true },
        userId: { type: String, required: false },
        deviceId: { type: String, required: false },
        askedAt: { type: Date, default: Date.now },
        source: {
          type: String,
          enum: ['user', 'ai'],
          default: 'user',
        },
      },
    ],
    default: [],
  })
  questionsAsked: {
    question?: string; // ✅ Optional
    answer: string;
    userId?: string;
    deviceId?: string;
    askedAt: Date;
    source: 'user' | 'ai';
  }[];

  @Prop({ type: Map, of: Number, default: {} })
  userPercentages: Map<string, number>;

  // Store per-user flashcard accuracy percentages for this subtopic
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
  flashcardAccuracies: { userId: string; accuracy: number; gamesPlayed: number }[];

  // Store per-user battle accuracy percentages for this subtopic
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
        answer: { type: String, required: true },
        topic: {
          type: {
            title: { type: String, required: false },
            description: { type: String, required: false },
          },
          required: false,
        },
        requestedAt: { type: Date, default: Date.now },
        source: {
          type: String,
          enum: ['ai'],
          required: false,
        },
      },
    ],
    default: [],
  })
  moreDetailsRequests: {
    userId?: string;
    deviceId?: string;
    answer: string;
    topic?: {
      title?: string;
      description?: string;
    };
    requestedAt: Date;
    source?: 'ai';
  }[];
}

export const SubTopicSchema = SchemaFactory.createForClass(SubTopic);
