import {
  Injectable,
  NotFoundException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  SubscriptionPlan,
  SubscriptionPlanDocument,
} from './entities/subscription-plan.entity';
import { Model, isValidObjectId } from 'mongoose';
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectModel(SubscriptionPlan.name)
    private readonly subscriptionPlanModel: Model<SubscriptionPlanDocument>,
  ) {}

  async create(createSubscriptionPlanDto: CreateSubscriptionPlanDto) {
    try {
      const newSubscriptionPlan = new this.subscriptionPlanModel({
        subscriptionType: createSubscriptionPlanDto.subscriptionType,
        amount: createSubscriptionPlanDto.amount,
        currency: createSubscriptionPlanDto.currency,
        name: createSubscriptionPlanDto.name,
      });

      const savedSubscriptionPlan = await newSubscriptionPlan.save();

      return {
        statusCode: HttpStatus.CREATED,
        message: 'Subscription plan created successfully.',
        data: savedSubscriptionPlan,
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findAll() {
    try {
      const subscriptionPlans = await this.subscriptionPlanModel
        .find({ isDeleted: false })
        .sort({ createdAt: -1 })
        .exec();

      return {
        statusCode: HttpStatus.OK,
        message: 'Subscription plans retrieved successfully.',
        data: subscriptionPlans,
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findOne(id: string) {
    try {
      if (!isValidObjectId(id)) {
        throw new BadRequestException('Invalid subscription plan ID.');
      }

      const subscriptionPlan = await this.subscriptionPlanModel
        .findOne({ _id: id, isDeleted: false })
        .exec();

      if (!subscriptionPlan) {
        throw new NotFoundException('Subscription plan not found.');
      }

      return {
        statusCode: HttpStatus.OK,
        message: 'Subscription plan retrieved successfully.',
        data: subscriptionPlan,
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async remove(id: string) {
    try {
      if (!isValidObjectId(id)) {
        throw new BadRequestException('Invalid subscription plan ID.');
      }

      const subscriptionPlan =
        await this.subscriptionPlanModel.findByIdAndUpdate(
          id,
          { isDeleted: true },
          { new: true },
        );

      if (!subscriptionPlan) {
        throw new NotFoundException('Subscription plan not found.');
      }

      return {
        statusCode: HttpStatus.OK,
        message: 'Subscription plan deleted successfully.',
        data: subscriptionPlan,
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
