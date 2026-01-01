import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type e from 'express';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
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
    return { id: payload.id, role: payload.role };
  }
}
