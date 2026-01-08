import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import {
  GameType,
  GameMode,
  Difficulty,
  BrawlGameType,
  DeckSelectionMethod,
} from 'src/common/enum';

export type GameDocument = Game & Document;

@Schema({ timestamps: true })
export class Game {
  @Prop({ required: true, unique: true })
  gameId: string;

  @Prop({ required: true, enum: Object.values(GameType) })
  type: GameType;

  @Prop({ required: false, enum: Object.values(GameMode) })
  gameMode: GameMode;

  @Prop({ required: true, type: [String] })
  players: string[];

  @Prop({ required: true })
  subTopicId: string;

  @Prop({ type: [String], default: [] })
  pendingRequests: string[];

  @Prop({ default: 0 })
  currentQuestion: number;

  @Prop({ type: Object, default: {} })
  scores: Record<string, number>;

  @Prop({ default: false })
  isCompleted: boolean;

  @Prop({ type: Date, default: Date.now })
  lastQuestionTimestamp: Date;

  @Prop({ default: 30 })
  questionTimeLimit: number;

  @Prop({ required: true, enum: Object.values(Difficulty) })
  difficulty: Difficulty;

  @Prop({ type: [Object] })
  questions: Array<{
    question: string;
    options?: string[];
    correctAnswer: string;
  }>;

  @Prop({ type: [String], default: [] })
  acceptedPlayers: string[];

  @Prop({ enum: Object.values(BrawlGameType) })
  brawlGameType: BrawlGameType;

  @Prop({ enum: Object.values(DeckSelectionMethod) })
  deckSelectionMethod: DeckSelectionMethod;

  @Prop()
  selectedDeckId: string;

  @Prop({ type: [String], default: [] })
  eliminatedPlayers: string[];

  @Prop({ type: Object, default: {} })
  wrongAnswersCount: Record<string, number>;

  @Prop({ type: Object })
  matchmakingStatus: {
    isRandomMatchmaking: boolean;
    retryCount: number;
    potentialPlayers: string[];
  };

  @Prop({ type: [Object] })
  playerAnswers: Array<{
    userId: string;
    questionIndex: number;
    answer: string;
    isCorrect: boolean;
    timestamp: Date;
  }>;

  @Prop()
  gameStarted: boolean;

  @Prop({ type: Date })
  startTime: Date;

  @Prop({ type: Object })
  metadata: Record<string, any>;

  @Prop({ type: Object, default: {} })
  accuracy: Record<string, number>;
}

export const GameSchema = SchemaFactory.createForClass(Game);
