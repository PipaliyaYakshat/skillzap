import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/lib/jwt-auth.guard';
import { RolesGuard } from 'src/auth/lib/roles.guard';
import { Roles } from 'src/auth/lib/roles.decorator';

@ApiTags('Subscription Controller')
@Controller('subscription')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('access-token')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Post()
  @Roles('admin')
  @ApiOperation({
    summary: 'Create a new subscription plan',
    description: 'Admin only. Creates a new subscription plan with the provided details.',
  })
  @ApiBody({ type: CreateSubscriptionPlanDto })
  @ApiResponse({
    status: 201,
    description: 'Subscription plan created successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid input data',
  })
  create(@Body() createSubscriptionPlanDto: CreateSubscriptionPlanDto) {
    return this.subscriptionService.create(createSubscriptionPlanDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all subscription plans',
    description: 'Retrieves all active (non-deleted) subscription plans available in the system.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of subscription plans retrieved successfully',
  })
  getAll() {
    return this.subscriptionService.findAll();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get subscription plan by ID',
    description: 'Retrieves a single subscription plan by its ID. The ID must be a valid MongoDB ObjectId.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Subscription plan ID to retrieve',
    example: '67501b23842d45d1c3d9f91a',
  })
  @ApiResponse({
    status: 200,
    description: 'Subscription plan retrieved successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid subscription plan ID format',
  })
  @ApiResponse({
    status: 404,
    description: 'Subscription plan not found',
  })
  findOne(@Param('id') id: string) {
    return this.subscriptionService.findOne(id);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({
    summary: 'Delete subscription plan by ID',
    description: 'Admin only. Soft deletes a subscription plan by setting isDeleted flag to true. The ID must be a valid MongoDB ObjectId.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Subscription plan ID to delete',
    example: '67501b23842d45d1c3d9f91a',
  })
  @ApiResponse({
    status: 200,
    description: 'Subscription plan deleted successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid subscription plan ID format',
  })
  @ApiResponse({
    status: 404,
    description: 'Subscription plan not found',
  })
  remove(@Param('id') id: string) {
    return this.subscriptionService.remove(id);
  }
}

