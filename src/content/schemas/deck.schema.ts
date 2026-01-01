import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DeckDocument = Deck & Document;

@Schema({ timestamps: true })
export class Deck {
  @Prop({ required: false, type: Types.ObjectId, ref: 'User' })
  userId: string;

  @Prop({ required: false, type: Types.ObjectId, ref: 'DeviceAccess' })
  deviceId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: false })
  description: string;

  @Prop({ type: [String], default: [] })
  contentIds: string[];

  @Prop({ default: false })
  isDefault: boolean;

  @Prop({ default: false })
  isPublic: boolean;

  @Prop({ default: 'pending' })
  status: string;

  @Prop({ default: '', required: false })
  category: string;

  // Store per-user flashcard accuracy percentages for this deck
  @Prop({
    type: [
      {
        userId: { type: Types.ObjectId, ref: 'User' },
        accuracy: { type: Number, default: 0 },
        gamesPlayed: { type: Number, default: 0 },
      },
    ],
    default: [],
  })
  flashcardAccuracies: { userId: string; accuracy: number; gamesPlayed: number }[];

  // Store per-user battle accuracy percentages for this deck
  @Prop({
    type: [
      {
        userId: { type: Types.ObjectId, ref: 'User' },
        accuracy: { type: Number, default: 0 },
        gamesPlayed: { type: Number, default: 0 },
      },
    ],
    default: [],
  })
  battleAccuracies: { userId: string; accuracy: number; gamesPlayed: number }[];

  readonly createdAt?: Date;
  readonly updatedAt?: Date;
}

export const DeckSchema = SchemaFactory.createForClass(Deck);
