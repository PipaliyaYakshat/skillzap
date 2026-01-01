import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { DeviceAccessService } from '../device-access.service';

@Injectable()
export class FlexibleAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private deviceService: DeviceAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    const authHeader = req.headers['authorization'];
    const deviceId = req.headers['x-device-id'];

    // ✅ 1. If Authorization token is present → verify it and skip device check
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = this.jwtService.verify(token);
        req.user = decoded; // attach user to request
        return true;
      } catch (err) {
        throw new UnauthorizedException('Invalid or expired token');
      }
    }

    // ✅ 2. Only check device access if no valid token is present
    if (!deviceId) {
      throw new UnauthorizedException(
        'Device ID required for unauthenticated access',
      );
    }

    return true;
  }
}
