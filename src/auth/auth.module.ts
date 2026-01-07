import { Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './lib/jwt.strategy';
import { User, UserSchema } from 'src/users/entities/user.entity';
import { MailService } from '../common/mail.service';
import {
  AdminCreation,
  AdminCreationSchema,
} from '../organization/entities/admin-creation.entity';
import {
  TeamMember,
  TeamMemberSchema,
} from '../organization/entities/team-member.entity';
import {
  ContentFileData,
  ContentFileDataSchema,
} from '../organization/entities/content-file-data.entity';
import {
  GameProgress,
  GameProgressSchema,
} from '../content/schemas/game-progress.schema';
import {
  TempRegistration,
  TempRegistrationSchema,
} from './schemas/temp-registration.schema';
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AdminCreation.name, schema: AdminCreationSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
      { name: ContentFileData.name, schema: ContentFileDataSchema },
      { name: GameProgress.name, schema: GameProgressSchema },
      { name: TempRegistration.name, schema: TempRegistrationSchema },
    ]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService): Promise<any> => {
        const expiresIn = configService.get<string>('JWT_EXPIRES_IN') ?? '30d';
        return {
          secret: configService.get<string>('JWT_SECRET') ?? 'TOKEN',
          signOptions: {
            expiresIn: expiresIn,
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtService, MailService],
})
export class AuthModule {}
