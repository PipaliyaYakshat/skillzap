import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../../users/entities/user.entity';
import { USER_TYPE } from 'src/common/enum';

@Injectable()
export class TeamOnlyGuard implements CanActivate {
  constructor(@InjectModel(User.name) private userModel: Model<User>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.id) {
      throw new BadRequestException('User not authenticated');
    }

    const userDoc = await this.userModel.findById(user.id);
    return userDoc?.userType === USER_TYPE[1];
  }
}
