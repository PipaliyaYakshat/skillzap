import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ContentType, CONTENT_TYPES, ProcessingStatus } from 'src/common/enum';

class QuestionDto {
  @IsString()
  question: string;

  @IsArray()
  @IsString({ each: true })
  options: string[];

  @IsString()
  correctAnswer: string;
}

class SubTopicDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  @IsArray()
  questions?: QuestionDto[];
}

export class TopicDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubTopicDto)
  subTopics?: SubTopicDto[];
}

export class CreateContentDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsEnum(ContentType)
  contentType: ContentType;

  @IsOptional()
  @IsString()
  contentName?: string;

  @IsOptional()
  @IsString()
  fileUrl?: string;

  @IsOptional()
  @IsString()
  filePath?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  isProcessed?: boolean;

  @IsOptional()
  @IsBoolean()
  isProcessing?: boolean;

  @IsOptional()
  @IsEnum(ProcessingStatus)
  processingStatus?: ProcessingStatus;

  @IsOptional()
  @IsNumber()
  processingProgress?: number;

  @IsOptional()
  @IsString()
  processingStage?: string;

  @IsOptional()
  @IsString()
  processingMessage?: string;

  @IsOptional()
  @IsDate()
  processingStartedAt?: Date;

  @IsOptional()
  @IsDate()
  processingCompletedAt?: Date;

  @IsOptional()
  @IsString()
  processingError?: string;

  @IsOptional()
  @IsBoolean()
  isUnregisteredUser?: boolean;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  deckId?: string;

  @IsOptional()
  @IsString()
  youtubeUrl?: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => TopicDto)
  @IsArray()
  topics?: TopicDto[];
}
