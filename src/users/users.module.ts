import { Module, forwardRef } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './entities/user.entity';
import { UserGame, UserGameSchema } from './entities/user-game.entity';
import {
  SubscriptionPlan,
  SubscriptionPlanSchema,
} from 'src/subscription/entities/subscription-plan.entity';
import {
  ContentFileData,
  ContentFileDataSchema,
} from 'src/organization/entities/content-file-data.entity';
import {
  Organization,
  OrganizationSchema,
} from 'src/organization/entities/orgenaztion.entity';
import { MailService } from 'src/common/mail.service';
import {
  GameProgress,
  GameProgressSchema,
} from 'src/content/schemas/game-progress.schema';
import { Deck, DeckSchema } from 'src/content/schemas/deck.schema';
import { ContentModule } from 'src/content/content.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: UserGame.name, schema: UserGameSchema },
      { name: SubscriptionPlan.name, schema: SubscriptionPlanSchema },
      { name: ContentFileData.name, schema: ContentFileDataSchema },
      { name: GameProgress.name, schema: GameProgressSchema },
      { name: Deck.name, schema: DeckSchema },
      { name: Organization.name, schema: OrganizationSchema },
    ]),
    forwardRef(() => ContentModule),
  ],
  controllers: [UsersController],
  providers: [UsersService, MailService],
  exports: [UsersService],
})
export class UsersModule {}
