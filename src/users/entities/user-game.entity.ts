import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class UserGame extends Document {
  @Prop({ required: true })
  userId: string;

  @Prop({ type: String, required: true })
  contactNumber: string;

  @Prop({ type: Object })
  scores: Record<string, number>;

  @Prop({ type: [String] })
  players: string[];

  @Prop()
  currentQuestion: number;

  @Prop({ type: Array })
  questions: Array<{
    question: string;
    options: string[];
    correctAnswer: number;
  }>;

  @Prop({
    type: [
      {
        gameId: String,
        opponentId: String,
        subtopic: String,
        score: Number,
        result: String,
        date: Date,
      },
    ],
    default: [],
  })
  gameHistory: Array<{
    gameId: string;
    opponentId: string;
    subtopic: string;
    score: number;
    result: string;
    date: Date;
  }>;

  @Prop({ type: [{ fromUserId: String, subtopic: String, timestamp: Date }] })
  pendingGameRequests: Array<{
    fromUserId: string;
    subtopic: string;
    timestamp: Date;
  }>;

  @Prop()
  currentGameId: string;
}

export type UserGameDocument = UserGame & Document;
export const UserGameSchema = SchemaFactory.createForClass(UserGame);
