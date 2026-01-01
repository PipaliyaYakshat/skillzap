import {
  Controller,
  Get,
  Param,
  Delete,
  UseGuards,
  Patch,
  Post,
  Req,
  Body,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  Query,
} from '@nestjs/common';
import { UsersService } from './users.service';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiTags,
  ApiQuery,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from 'src/auth/lib/jwt-auth.guard';
import { Roles } from 'src/auth/lib/roles.decorator';
import { RolesGuard } from 'src/auth/lib/roles.guard';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { multerProfileImageOptions } from '../common/multer.service';
import { BuyPlanDto } from './dto/buy-plan.dto';
import { PurchaseLiveDto } from './dto/purchase-live.dto';
import { PurchaseCoinDto } from './dto/purchase-coin.dto';
import { PurchaseAvatarDto } from './dto/purchase-avatar.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@ApiTags('Users Controller')
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('access-token')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('profile')
  @ApiOperation({
    summary: 'Get authenticated user profile',
    description: 'Retrieves the profile information of the currently authenticated user.',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
  })
  async findMyProfile(@Req() req) {
    const userId = req.user.id;
    return await this.usersService.findOne(userId);
  }

  @Patch('profile')
  @UseInterceptors(FileInterceptor('profileImage', multerProfileImageOptions))
  @ApiOperation({
    summary: 'Update authenticated user profile',
    description: 'Updates the profile information of the currently authenticated user. Optionally uploads a profile image.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({
    status: 200,
    description: 'User profile updated successfully',
  })
  async updateMyProfile(
    @Req() req,
    @Body() updateUserDto: UpdateUserDto,
    @UploadedFile() profileImage: Express.Multer.File,
  ) {
    const userId = req.user.id;
    return await this.usersService.updateUser(
      userId,
      updateUserDto,
      profileImage,
    );
  }

  @Post('plan/buy')
  @ApiOperation({
    summary: 'Purchase a subscription plan',
    description: 'Allows the authenticated user to purchase a subscription plan using card details.',
  })
  @ApiBody({ type: BuyPlanDto })
  @ApiResponse({
    status: 200,
    description: 'Subscription plan purchased successfully',
  })
  async buyPlan(@Req() req, @Body() buyPlanDto: BuyPlanDto) {
    const userId = req.user.id;
    return await this.usersService.buySubscriptionPlan(userId, buyPlanDto);
  }

  @Post('lives/purchase')
  @ApiOperation({
    summary: 'Purchase lives',
    description: 'Allows the authenticated user to purchase additional lives using a subscription plan.',
  })
  @ApiBody({ type: PurchaseLiveDto })
  @ApiResponse({
    status: 200,
    description: 'Lives purchased successfully',
  })
  async purchaseLive(@Req() req, @Body() purchaseLiveDto: PurchaseLiveDto) {
    const userId = req.user.id;
    return await this.usersService.purchaseLive(userId, purchaseLiveDto);
  }

  @Post('avatars/purchase')
  @ApiOperation({
    summary: 'Purchase an avatar',
    description: 'Allows the authenticated user to purchase an avatar using coins.',
  })
  @ApiBody({ type: PurchaseAvatarDto })
  @ApiResponse({
    status: 200,
    description: 'Avatar purchased successfully',
  })
  async purchaseAvatar(
    @Req() req,
    @Body() purchaseAvatarDto: PurchaseAvatarDto,
  ) {
    const userId = req.user.id;
    return await this.usersService.purchaseAvatar(userId, purchaseAvatarDto);
  }

  @Post('coins/purchase')
  @ApiOperation({
    summary: 'Purchase coins',
    description: 'Allows the authenticated user to purchase coins using a subscription plan.',
  })
  @ApiBody({ type: PurchaseCoinDto })
  @ApiResponse({
    status: 200,
    description: 'Coins purchased successfully',
  })
  async purchaseCoin(@Req() req, @Body() purchaseCoinDto: PurchaseCoinDto) {
    const userId = req.user.id;
    return await this.usersService.purchaseCoin(userId, purchaseCoinDto);
  }

  @Get('plan/me')
  @ApiOperation({
    summary: 'Get authenticated user subscription plan',
    description: 'Retrieves the current subscription plan details for the authenticated user.',
  })
  @ApiResponse({
    status: 200,
    description: 'User subscription plan retrieved successfully',
  })
  async getPlanMe(@Req() req) {
    const userId = req.user.id;
    return await this.usersService.getMyPlan(userId);
  }

  @Delete('account')
  @ApiOperation({
    summary: 'Delete authenticated user account',
    description: 'Permanently deletes the authenticated user account and all associated data.',
  })
  @ApiResponse({
    status: 200,
    description: 'User account deleted successfully',
  })
  async deleteAccount(@Req() req) {
    const userId = req.user.id;
    return await this.usersService.remove(userId);
  }

  @Post('logout')
  @ApiOperation({
    summary: 'Logout user',
    description: 'Logs out the authenticated user by invalidating their session.',
  })
  @ApiResponse({
    status: 200,
    description: 'User logged out successfully',
  })
  async logout(@Req() req) {
    const userId = req.user.id;
    return await this.usersService.logout(userId);
  }

  @Post('change-password')
  @ApiOperation({
    summary: 'Change user password',
    description: 'Allows the authenticated user to change their password by providing the old password and new password.',
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({
    status: 200,
    description: 'Password changed successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid old password or bad request',
  })
  async changePassword(@Req() req, @Body() changePasswordDto: ChangePasswordDto) {
    const userId = req.user.id;
    return await this.usersService.changePassword(userId, changePasswordDto);
  }

}
