import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MemberProgressDocument = MemberProgress & Document;

@Schema({ timestamps: true })
export class MemberProgress extends Document {
  @Prop({ required: false })
  userId: string;

  @Prop({ required: false })
  deviceId: string;

  @Prop({ default: 1 })
  level: number;

  @Prop({ default: 0 })
  totalCorrectAnswers: number;

  @Prop({ default: 0 })
  totalScore: number;

  @Prop({ default: 0 })
  points: number;

  @Prop({ default: 0 })
  coins: number;

  @Prop({ default: 50 })
  lives: number;

  @Prop({ type: Date })
  nextLivesRefillAt: Date | null;

  @Prop({ default: 0 })
  accuracy: number;

  @Prop({ default: 0 })
  bestStreak: number;

  @Prop({ default: 0 })
  totalQuestions: number;

  @Prop({ default: 0 })
  totalWrongAnswers: number;

  @Prop({ type: Object, default: {} })
  levelProgress: {
    currentLevel: number;
    nextLevelThreshold: number;
    progress: number;
  };

  @Prop({ type: [String], default: ['Spark'] })
  badges: string[];

  @Prop({ default: 0 })
  totalGamesPlayed: number;

  @Prop({ default: 0 })
  globalRank: number;

  // Add a compound index to ensure either userId or deviceId is present
  @Prop({ type: Boolean, default: false })
  isDeviceUser: boolean;

  @Prop({ default: 0 })
  totalWins: number;

  @Prop({ default: 0 })
  totalLosses: number;

  // Daily streak tracking fields
  @Prop({ default: 0 })
  currentDailyStreak: number;

  @Prop({ default: 0 })
  longestDailyStreak: number;

  @Prop({ type: Date })
  lastGamePlayDate: Date;

  @Prop({ type: [String], default: [] })
  dailyStreakIcons: string[];

  // Track games played per day for 7-day icon system
  @Prop({ type: Object, default: {} })
  dailyGamesCount: Record<string, number>; // Key: date string (YYYY-MM-DD), Value: games count
}

export const MemberProgressSchema =
  SchemaFactory.createForClass(MemberProgress);

// Add compound index to ensure either userId or deviceId is present, but not both
MemberProgressSchema.index(
  { userId: 1, deviceId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      $or: [
        { userId: { $exists: true, $ne: null } },
        { deviceId: { $exists: true, $ne: null } },
      ],
    },
  },
);

// Add validation to ensure either userId or deviceId is present
MemberProgressSchema.pre('save', function (next) {
  if (!this.userId && !this.deviceId) {
    return next(new Error('Either userId or deviceId is required'));
  }
  if (this.userId && this.deviceId) {
    return next(new Error('Cannot have both userId and deviceId'));
  }
  this.isDeviceUser = !!this.deviceId;
  next();
});
