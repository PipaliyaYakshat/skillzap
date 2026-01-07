import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type TeamGameDocument = TeamGame & Document;

@Schema({ timestamps: true })
export class TeamGame extends Document {
  @Prop({ required: true, unique: true })
  gameId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Team', required: true })
  team: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  creator: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  })
  organization: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, enum: ['REGULAR', 'KNOCKOUT'] })
  gameMode: 'REGULAR' | 'KNOCKOUT';

  @Prop({ required: true, enum: ['random', 'selected'] })
  deckSelectionMethod: 'random' | 'selected';

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Deck' })
  selectedDeckId: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Content' })
  selectedContentId: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Topic' })
  selectedTopicId: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'SubTopic' })
  selectedSubTopicId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: [MongooseSchema.Types.ObjectId],
    ref: 'TeamMember',
    default: [],
  })
  participants: MongooseSchema.Types.ObjectId[];

  @Prop({
    type: [MongooseSchema.Types.ObjectId],
    ref: 'TeamMember',
    default: [],
  })
  activeParticipants: MongooseSchema.Types.ObjectId[];

  @Prop({
    type: [MongooseSchema.Types.ObjectId],
    ref: 'TeamMember',
    default: [],
  })
  eliminatedParticipants: MongooseSchema.Types.ObjectId[];

  @Prop({ type: [MongooseSchema.Types.ObjectId], ref: 'User', default: [] })
  invitedParticipants: MongooseSchema.Types.ObjectId[];

  @Prop({ type: [MongooseSchema.Types.ObjectId], ref: 'User', default: [] })
  acceptedParticipants: MongooseSchema.Types.ObjectId[];

  @Prop({ type: [MongooseSchema.Types.ObjectId], ref: 'User', default: [] })
  rejectedParticipants: MongooseSchema.Types.ObjectId[];

  @Prop({ default: 0 })
  currentQuestionIndex: number;

  @Prop({ type: [Object], default: [] })
  questions: Array<{
    question: string;
    options: string[];
    correctAnswer: string;
    explanation?: string;
  }>;

  @Prop({ type: Object, default: {} })
  scores: Record<string, number>;

  @Prop({ type: Object, default: {} })
  answers: Record<
    string,
    Array<{
      questionIndex: number;
      answer: string;
      isCorrect: boolean;
      timestamp: Date;
    }>
  >;

  @Prop({ type: Object, default: {} })
  wrongAnswersCount: Record<string, number>;

  @Prop({ type: Object, default: {} })
  lastQuestionTimestamp: Record<string, Record<number, Date>>;

  @Prop({ default: 20 })
  questionTimeLimit: number;

  @Prop({
    required: true,
    enum: ['WAITING', 'STARTED', 'COMPLETED', 'CANCELED'],
    default: 'WAITING',
  })
  status: 'WAITING' | 'STARTED' | 'COMPLETED' | 'CANCELED';

  @Prop({ type: Date })
  startedAt: Date;

  @Prop({ type: Date })
  completedAt: Date;

  @Prop({ type: [Object], default: [] })
  chatMessages: Array<{
    participantId: MongooseSchema.Types.ObjectId;
    teamId: MongooseSchema.Types.ObjectId; // Add teamId to track which team sent the message
    message: string;
    timestamp: Date;
  }>;

  // ✅ Individual member answers - each participant can answer independently
  @Prop({ type: Map, of: Map, default: () => new Map() })
  teamAnswers: Map<
    string,
    Map<
      string,
      {
        participantId: string;
        answer: string;
        isCorrect: boolean;
        timestamp: Date;
        teamId: string; // Store team ID for reference
      }
    >
  >;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const TeamGameSchema = SchemaFactory.createForClass(TeamGame);

// New: TeamGameScore schema for storing per-user, per-team scores after game completion
export type TeamGameScoreDocument = TeamGameScore & Document;

@Schema({ timestamps: true })
export class TeamGameScore extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Team', required: true })
  teamId: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: MongooseSchema.Types.ObjectId;

  // @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'TeamGame', required: true })
  // gameId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  points: number;

  // --- Analytics fields ---
  @Prop({ type: Number, default: 0 })
  accuracy: number; // percentage of correct answers

  @Prop({ type: Number, default: 0 })
  averageResponseTime: number; // average response time in seconds

  @Prop({ type: Number, default: 0 })
  gamesPlayed: number; // number of games played (for calculating running average)

  @Prop({ type: Object, default: {} })
  knowledgeImprovement: Record<
    string,
    {
      correct: number;
      total: number;
      percentage: number;
    }
  >;

  // Subject-wise analytics fields

  // Subject/mode analytics (flashcard/battle accuracy and improvement)
  @Prop({ type: Object, default: {} })
  subjectModeStats?: Record<
    string,
    {
      flashcardAccuracy: number;
      battleAccuracy: number;
      flashcardImprovement: number;
      battleImprovement: number;
    }
  >;
}

export const TeamGameScoreSchema = SchemaFactory.createForClass(TeamGameScore);

// Add unique index to prevent duplicates
TeamGameScoreSchema.index(
  { teamId: 1, userId: 1, gameId: 1 },
  { unique: true },
);
