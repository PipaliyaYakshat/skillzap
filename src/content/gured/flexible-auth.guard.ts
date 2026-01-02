import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DeviceAccessService } from '../device-access.service';
import { User, UserDocument } from 'src/users/entities/user.entity';

@Injectable()
export class FlexibleAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private deviceService: DeviceAccessService,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
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
        // Check if user is blocked
        const user = await this.userModel.findById(decoded.id).exec();
        if (!user) {
          throw new UnauthorizedException('User not found');
        }
        if (user.isBlocked === true) {
          throw new UnauthorizedException('Your account is blocked');
        }
        req.user = decoded; // attach user to request
        return true;
      } catch (err) {
        if (err instanceof UnauthorizedException) {
          throw err;
        }
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
