import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../../users/entities/user.entity';
import { AdminCreation } from '../entities/admin-creation.entity';
import { USER_TYPE } from 'src/common/enum';

@Injectable()
export class TeamRoleGuard implements CanActivate {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(AdminCreation.name)
    private adminCreationModel: Model<AdminCreation>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.id) {
      throw new BadRequestException('User not authenticated');
    }

    const userDoc = await this.userModel.findById(user.id);
    if (!userDoc) {
      throw new BadRequestException('User not found');
    }

    // If user is team type, allow access
    if (userDoc?.userType === USER_TYPE[1]) {
      return true;
    }

    // If user is admin type, check their approval status
    if (userDoc?.userType === USER_TYPE[2]) {
      const adminCreation = await this.adminCreationModel.findOne({
        createdAdmin: user.id,
        // status: 'approved'
      });

      // if (!adminCreation) {
      //   throw new BadRequestException('Your admin access is pending approval');
      // }

      return true;
    }

    throw new ForbiddenException(
      'You do not have permission to access this resource',
    );
  }
}
