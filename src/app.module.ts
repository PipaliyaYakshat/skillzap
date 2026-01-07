import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MongooseModule } from '@nestjs/mongoose';
import { ContentModule } from './content/content.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { TeamModule } from './organization/team.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri:
          configService.get<string>('DATABASE_URL') ??
          'mongodb://localhost:27017/skillzap',
        connectionFactory: (connection) => {
          console.log('connected to mongodb');
          return connection;
        },
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    UsersModule,
    ContentModule,
    SubscriptionModule,
    TeamModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
