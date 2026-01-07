import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { USER_TYPE } from 'src/common/enum';

export type TempRegistrationDocument = TempRegistration & Document;

@Schema({ timestamps: true })
export class TempRegistration extends Document {
  @Prop({ type: String, required: false, default: null })
  name: string | null;

  @Prop({ type: String, required: true })
  contactNumber: string;

  @Prop({ type: String, required: true, unique: true })
  email: string;

  @Prop({ type: String, required: true })
  password: string;

  @Prop({ type: String, required: true })
  countryCode: string;

  @Prop({ type: Number, required: false, default: null })
  monthOfBirth: number | null;

  @Prop({ type: Number, required: false, default: null })
  yearOfBirth: number | null;

  @Prop({ type: Number, required: true })
  otp: number;

  @Prop({ type: Date, required: true })
  otpSendDate: Date;

  @Prop({ type: String, default: USER_TYPE[0] })
  userType: string;

  @Prop({ type: String, default: null, required: false })
  teamPlan: string | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Organization',
    required: false,
  })
  organization: MongooseSchema.Types.ObjectId | null;

  @Prop({ type: String, default: null, required: false })
  pendingAdminId: string | null;

  @Prop({ type: String, default: null, required: false })
  pendingTeamMemberId: string | null;
}

export const TempRegistrationSchema = SchemaFactory.createForClass(TempRegistration);

// Add TTL index to auto-delete expired registrations after 10 minutes
TempRegistrationSchema.index({ otpSendDate: 1 }, { expireAfterSeconds: 600 });

