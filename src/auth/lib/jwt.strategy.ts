import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type e from 'express';
import { User, UserDocument } from 'src/users/entities/user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: 'TOKEN',
      passReqToCallback: true,
    });
  }

  async validate(
    req: e.Request,
    payload: { id: string; role?: string },
  ): Promise<{ id: string; role?: string }> {
    // Check if user is blocked
    const user = await this.userModel.findById(payload.id).exec();
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    if (user.isBlocked === true) {
      throw new UnauthorizedException('Your account is blocked');
    }
    return { id: payload.id, role: payload.role };
  }
}
