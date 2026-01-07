import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { USER_ROLE } from 'src/common/enum';

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ type: String, required: false, default: null })
  name: string | null;

  @Prop({ type: String, required: true })
  contactNumber: string;

  @Prop({ type: String, required: true })
  email: string;

  @Prop({ type: String, required: true })
  password: string;

  @Prop({ type: String, required: true })
  countryCode: string;

  @Prop({ type: Boolean, default: false })
  isOnline: boolean;

  @Prop({ type: Number, default: null })
  otp: number | null;

  @Prop({ type: Date, default: null })
  otpSendDate: Date | null;

  @Prop({ default: false })
  forgotPassword: boolean;

  @Prop({ type: Boolean, default: false })
  verifyOtp: boolean;

  @Prop({ type: String, required: false })
  socketId: string;

  @Prop({ type: Date, required: false })
  lastSeen: Date;

  @Prop({ type: Boolean, default: false })
  socketConnected: boolean;

  @Prop({
    type: {
      connectedAt: { type: Date, required: false },
      disconnectedAt: { type: Date, required: false },
      connectionCount: { type: Number, required: false, default: 0 },
      lastActivity: { type: Date, required: false },
    },
    required: false,
    _id: false,
  })
  socketInfo: {
    connectedAt: Date;
    disconnectedAt: Date;
    connectionCount: number;
    lastActivity: Date;
  };

  @Prop({ type: String, default: 'Individual' })
  userType: string;

  @Prop({ type: String, default: null, required: false })
  teamPlan: string;

  @Prop({
    type: {
      companyName: { type: String, required: false },
      companySize: { type: Number, required: false },
      industry: { type: String, required: false },
      address: { type: String, required: false },
      phone: { type: String, required: false },
    },
    required: false,
    _id: false,
  })
  teamDetails: {
    companyName: string;
    companySize: number;
    industry: string;
    address: string;
    phone: string;
  };

  @Prop({ type: String, required: false })
  refreshToken: string;

  @Prop({ type: String, enum: ['static', 'purchased'], required: false })
  avatarType: 'static' | 'purchased';

  @Prop({ type: [String], required: false, default: [] })
  avatarId: string[];

  @Prop({ type: String, required: false })
  profileImage: string;

  @Prop({ type: [String], default: [], required: false })
  purchasedAvatars: string[];

  @Prop({ type: String, default: null, required: false })
  organizerLogo: string;

  @Prop({ type: String, default: null, required: false })
  organizerName: string;

  @Prop({ type: String, required: false })
  deviceId: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Organization',
    required: false,
  })
  organization: MongooseSchema.Types.ObjectId;

  @Prop({ type: String, enum: ['email', 'google', 'apple'], default: 'email' })
  authProvider: string;

  @Prop({ type: String, required: false })
  firebaseUid: string;

  @Prop({ type: Number, required: false, default: null })
  monthOfBirth: number | null;

  @Prop({ type: Number, required: false, default: null })
  yearOfBirth: number | null;

  @Prop({ type: Number, default: 0, required: false })
  coins: number;

  @Prop({ type: Number, default: 50, required: false })
  lives: number;

  @Prop({ type: Date, required: false })
  nextLivesRefillAt: Date | null;

  @Prop({ type: String, required: false, default: USER_ROLE[1] })
  role: string;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Boolean, default: false })
  isRegister: boolean;

  @Prop({ type: Boolean, default: false })
  isPayment: boolean;

  @Prop({ type: String, default: null })
  purchasePlanType: string | null;

  @Prop({ type: Types.ObjectId, ref: 'SubscriptionPlan', default: null })
  purchasePlanId: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  startPlanDate: Date | null;

  @Prop({ type: Date, default: null })
  expirePlanDate: Date | null;

  @Prop({ type: String, default: null })
  cardNumber: string | null;

  @Prop({ type: Boolean, default: false })
  isBlocked: boolean;
}

export type UserDocument = User & Document;
export const UserSchema = SchemaFactory.createForClass(User);
