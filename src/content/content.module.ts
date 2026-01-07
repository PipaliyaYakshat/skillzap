import { Module, forwardRef } from '@nestjs/common';
import { ContentService } from './content.service';
import { ContentController } from './content.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Gamebattl, GamebattlSchema } from './schemas/btal.game.schema';
import { Game, GameSchema } from './schemas/game.schema';
import { Content, ContentSchema } from './schemas/content.schema';
import { Topic, TopicSchema } from './schemas/topic.schema';
import { SubTopic, SubTopicSchema } from './schemas/subtopic.schema';
import {
  GameProgress,
  GameProgressSchema,
} from './schemas/game-progress.schema';
import {
  TopicProgress,
  TopicProgressSchema,
} from './schemas/topic-progress.schema';
import { User, UserSchema } from 'src/users/entities/user.entity';
import { Deck, DeckSchema } from './schemas/deck.schema';
import {
  DeviceAccess,
  DeviceAccessSchema,
} from './schemas/device-access.schema';
import { DeviceAccessService } from './device-access.service';
import { DeckAIService } from './deck-ai.service';
import { GameGateway } from './game.gateway';
import { FlexibleAuthGuard } from './gured/flexible-auth.guard';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { FileTextExtractionService } from './file-text-extraction.service';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Gamebattl.name, schema: GamebattlSchema },
      { name: Content.name, schema: ContentSchema },
      { name: Topic.name, schema: TopicSchema },
      { name: SubTopic.name, schema: SubTopicSchema },
      { name: Game.name, schema: GameSchema },
      { name: GameProgress.name, schema: GameProgressSchema },
      { name: TopicProgress.name, schema: TopicProgressSchema },
      { name: User.name, schema: UserSchema },
      { name: Deck.name, schema: DeckSchema },
      { name: DeviceAccess.name, schema: DeviceAccessSchema },
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') ?? 'TOKEN',
        signOptions: { expiresIn: '30d' },
      }),
      inject: [ConfigService],
    }),
    forwardRef(() => UsersModule),
  ],
  controllers: [ContentController],
  providers: [
    GameGateway,
    ContentService,
    DeckAIService,
    FlexibleAuthGuard,
    DeviceAccessService,
    FileTextExtractionService,
  ],
  exports: [ContentService, DeckAIService, DeviceAccessService, MongooseModule],
})
export class ContentModule {}
