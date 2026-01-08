import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { STATUS_UPDATE } from 'src/common/enum';

@Schema({ timestamps: true })
export class ContentFileData extends Document {
  @Prop({ required: true })
  firstName: string;

  @Prop({ required: true })
  lastName: string;

  @Prop({ required: true })
  contactNumber: string;

  @Prop({ required: true })
  organizationName: string;

  @Prop({ required: true })
  email: string;

  @Prop({ required: true })
  city: string;

  @Prop({ required: true })
  country: string;

  // @Prop({ required: true })
  // userId: string;

  @Prop({ required: false, default: STATUS_UPDATE[0] })
  status: string;

  @Prop({ type: String, required: true })
  aboutUs: string;

  @Prop({ type: String, required: false, default: null })
  countryCode: string;
}

export const ContentFileDataSchema =
  SchemaFactory.createForClass(ContentFileData);
