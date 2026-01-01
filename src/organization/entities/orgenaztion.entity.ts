import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type OrganizationDocument = Organization & Document;

@Schema({ timestamps: true })
export class Organization {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  logo: string; // Can be a URL if uploaded to Cloudinary or another service

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  creatorId: MongooseSchema.Types.ObjectId;
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization);
