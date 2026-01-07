import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

@Schema()
export class AdminCreation extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: false })
  creator: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: false })
  createdAdmin: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  })
  organization: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  email: string;

  @Prop({ required: false })
  name?: string;

  @Prop({ default: 'pending' })
  status: string;

  @Prop({ default: Date.now })
  createdAt: Date;
}

export const AdminCreationSchema = SchemaFactory.createForClass(AdminCreation);
