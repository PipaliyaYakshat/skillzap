import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/entities/user.entity';
import {
  SubscriptionPlan,
  SubscriptionPlanSchema,
} from 'src/subscription/entities/subscription-plan.entity';
import {
  ContentFileData,
  ContentFileDataSchema,
} from 'src/organization/entities/content-file-data.entity';
import { Deck, DeckSchema } from 'src/content/schemas/deck.schema';
import { Topic, TopicSchema } from 'src/content/schemas/topic.schema';
import { SubTopic, SubTopicSchema } from 'src/content/schemas/subtopic.schema';
import { Game, GameSchema } from 'src/content/schemas/game.schema';
import {
  GameProgress,
  GameProgressSchema,
} from 'src/content/schemas/game-progress.schema';
import { Content, ContentSchema } from 'src/content/schemas/content.schema';
import {
  Gamebattl,
  GamebattlSchema,
} from 'src/content/schemas/btal.game.schema';
import { UserGame, UserGameSchema } from 'src/users/entities/user-game.entity';
import {
  TeamGame,
  TeamGameSchema,
} from 'src/organization/entities/team-game.entity';
import { MailService } from 'src/common/mail.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: SubscriptionPlan.name, schema: SubscriptionPlanSchema },
      { name: ContentFileData.name, schema: ContentFileDataSchema },
      { name: Deck.name, schema: DeckSchema },
      { name: Topic.name, schema: TopicSchema },
      { name: SubTopic.name, schema: SubTopicSchema },
      { name: Game.name, schema: GameSchema },
      { name: GameProgress.name, schema: GameProgressSchema },
      { name: Content.name, schema: ContentSchema },
      { name: Gamebattl.name, schema: GamebattlSchema },
      { name: UserGame.name, schema: UserGameSchema },
      { name: TeamGame.name, schema: TeamGameSchema },
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService, MailService],
})
export class AdminModule {}
