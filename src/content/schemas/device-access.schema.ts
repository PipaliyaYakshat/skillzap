import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class DeviceAccess extends Document {
  @Prop({ required: true, unique: true })
  deviceId: string;

  @Prop({ default: 0 })
  accessCount: number;

  @Prop({ default: false })
  isRegistered: boolean;

  @Prop({ type: Object, default: {} })
  flowState: {
    currentFlow: string;
    step: number;
    lastUpdated: Date;
  };

  // New fields for tracking specific actions
  @Prop({ default: 0 })
  flashcardUploads: number;

  @Prop({ default: 0 })
  singlePlayerGames: number;

  @Prop({ default: 0 })
  battleGames: number;

  @Prop({ default: 3 })
  maxActions: number;

  @Prop({ type: [String], default: [] })
  actionHistory: string[]; // Track which actions were performed

  @Prop({ default: Date.now })
  lastActionAt: Date;
}

export const DeviceAccessSchema = SchemaFactory.createForClass(DeviceAccess);
