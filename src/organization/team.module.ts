import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TeamService } from './team.service';
import { TeamController } from './team.controller';
import { TeamGameService } from './team-game.service';
import { TeamGameGateway } from './team-game.gateway';
import { Organization, OrganizationSchema } from './entities/orgenaztion.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import { TeamOnlyGuard } from './guards/team-only.guard';
import { TeamRoleGuard } from './guards/team-role.guard';
import { AdminCreation, AdminCreationSchema } from './entities/admin-creation.entity';
import { SubscriptionPlan, SubscriptionPlanSchema } from '../subscription/entities/subscription-plan.entity';
import { Team, TeamSchema } from './entities/team.entity';
import { TeamMember, TeamMemberSchema } from './entities/team-member.entity';
import { Deck, DeckSchema } from '../content/schemas/deck.schema';
import { Game, GameSchema } from '../content/schemas/game.schema';
import { Topic, TopicSchema } from '../content/schemas/topic.schema';
import { SubTopic, SubTopicSchema } from '../content/schemas/subtopic.schema';
import { UsersModule } from '../users/users.module';
import { ContentModule } from '../content/content.module';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  MemberProgress,
  MemberProgressSchema,
} from './entities/member-progress.schema';
import { TeamGameScore, TeamGameScoreSchema } from './entities/team-game.entity';
import { TeamGameChat, TeamGameChatSchema } from './entities/teamgame-chat.entity';
import { GameProgress, GameProgressSchema } from '../content/schemas/game-progress.schema';
import { TopicProgress, TopicProgressSchema } from '../content/schemas/topic-progress.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: User.name, schema: UserSchema },
      { name: AdminCreation.name, schema: AdminCreationSchema },
      { name: SubscriptionPlan.name, schema: SubscriptionPlanSchema },
      { name: Team.name, schema: TeamSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
      { name: Deck.name, schema: DeckSchema },
      { name: Game.name, schema: GameSchema },
      { name: Topic.name, schema: TopicSchema },
      { name: SubTopic.name, schema: SubTopicSchema },
      { name: MemberProgress.name, schema: MemberProgressSchema },
      { name: TeamGameScore.name, schema: TeamGameScoreSchema },
      { name: TeamGameChat.name, schema: TeamGameChatSchema },
      { name: GameProgress.name, schema: GameProgressSchema },
      { name: TopicProgress.name, schema: TopicProgressSchema },
    ]),
    UsersModule,
    ContentModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') ?? 'TOKEN',
        signOptions: { expiresIn: '30d' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [TeamController],
  providers: [TeamService, TeamGameService, TeamGameGateway, TeamOnlyGuard, TeamRoleGuard],
  exports: [TeamService, TeamGameService],
})
export class TeamModule {}

