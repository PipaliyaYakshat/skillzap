import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ContentDocument = Content & Document;

@Schema({ timestamps: true })
export class Content {
  @Prop({ required: false })
  userId: string;

  @Prop({ required: false })
  deviceId: string;

  @Prop({
    required: true,
    enum: [
      'pdf',
      'ppt',
      'audio',
      'image',
      'youtube',
      'note',
      'powerpoint',
      'manual',
    ],
  })
  contentType: string;

  @Prop({ required: false })
  contentName: string;

  @Prop({ required: false })
  fileUrl: string;

  @Prop()
  filePath: string;

  @Prop({
    required: function (this: Content) {
      return this.contentType === 'manual' || this.contentType === 'note';
    },
  })
  title: string;

  @Prop()
  description: string;

  @Prop({ type: Object })
  metadata: Record<string, any>;

  @Prop({ default: false })
  isProcessed: boolean;

  @Prop({ default: false })
  isProcessing: boolean;

  @Prop({
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending',
  })
  processingStatus: string;

  @Prop({ default: 0 })
  processingProgress: number;

  @Prop()
  processingStage: string;

  @Prop()
  processingMessage: string;

  @Prop()
  processingStartedAt: Date;

  @Prop()
  processingCompletedAt: Date;

  @Prop()
  processingError: string;

  @Prop({ default: false })
  isUnregisteredUser: boolean;

  @Prop({ required: false })
  category: string;

  @Prop({
    required: function (this: Content) {
      return !this.deviceId && !this.userId; // Only require deckId if neither deviceId nor userId is present
    },
  })
  deckId: string;

  @Prop({ required: false })
  youtubeUrl: string;

  @Prop({ type: [Object], default: [] })
  topics: Array<{
    topicId: string;
    title: string;
    description: string;
    subTopics: Array<{
      subTopicId: string;
      title: string;
      description: string;
      questions: Array<{
        question: string;
        options: string[];
        correctAnswer: number;
      }>;
    }>;
  }>;
}

export const ContentSchema = SchemaFactory.createForClass(Content);
