import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';
import {
  GameBattleMode,
  GameBattleType,
  GameBattleStatus,
} from 'src/common/enum';

export type GamebattleDocument = Gamebattl & Document;

@Schema({ timestamps: true })
export class Gamebattl {
  @Prop({})
  hostUserId: string;

  @Prop({ enum: Object.values(GameBattleMode), required: true })
  mode: GameBattleMode;

  @Prop({ enum: Object.values(GameBattleType), default: GameBattleType.REGULAR })
  brawlType?: GameBattleType;

  @Prop({
    enum: Object.values(GameBattleStatus),
    default: GameBattleStatus.WAITING,
  })
  status: GameBattleStatus;

  @Prop({ type: Number, default: 3, min: 3, max: 10 })
  maxPlayers?: number;

  @Prop({ type: Object, default: {} })
  knockoutStatus?: { [userId: string]: number };

  @Prop({ type: Boolean, default: false })
  brawlStartTimerStarted?: boolean;

  @Prop({ type: [{ type: mongoose.Schema.Types.Mixed }] })
  invitedUserIds: (string | mongoose.Types.ObjectId)[];

  @Prop({ type: [{ type: mongoose.Schema.Types.Mixed }] })
  acceptedUserIds: (string | mongoose.Schema.Types.ObjectId)[];

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Topic', required: true })
  topicId: string;

  @Prop({ type: Number, default: 0 })
  currentQuestionIndex: number;

  @Prop({ type: [{ type: Object }] })
  questions: {
    questions: {
      question: string;
      options: string[];
      correctAnswer: string;
    }[];
  }[];

  @Prop({ type: Object, default: {} })
  answers: Record<string, any[]>;

  @Prop({ type: Object, default: {} })
  lastQuestionTimestamp: {
    [userId: string]: Date;
  };

  @Prop({ type: Object, default: {} })
  userWrongCount: {
    [userId: string]: number;
  };

  @Prop({ type: Object, default: {} })
  wrongAnswersCount: {
    [userId: string]: number;
  };

  @Prop({ type: [{ type: mongoose.Schema.Types.Mixed }], default: [] })
  eliminatedUsers: (string | mongoose.Schema.Types.ObjectId)[];

  @Prop({ type: Date })
  startedAt?: Date;

  @Prop({ type: Date })
  completedAt?: Date;

  @Prop({ type: String, default: 'random' })
  topicType?: string;

  @Prop({ type: String, default: '', required: false })
  selectedDeckId?: string;

  @Prop({ type: String, default: '', required: false })
  category?: string;

  @Prop({ type: Boolean, default: false })
  notInvite?: boolean;

  @Prop({ type: [String], default: [] })
  cancelledUserIds: string[];

  @Prop({ type: Boolean, default: false })
  isHost?: boolean;
}

export const GamebattlSchema = SchemaFactory.createForClass(Gamebattl);
