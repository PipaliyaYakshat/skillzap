import {
  Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, BadRequestException, Req,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import {
  ApiBearerAuth, ApiTags, ApiQuery, ApiOperation, ApiResponse, ApiBody, ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/lib/jwt-auth.guard';
import { Roles } from 'src/auth/lib/roles.decorator';
import { RolesGuard } from 'src/auth/lib/roles.guard';
import { USER_ROLE } from 'src/common/enum';
import { UpdateStatusEnterpriseDto } from '../users/dto/update-status-enterprise.dto';
import { ToggleUserStatusDto } from './dto/toggle-user-status.dto';
import { UpdateUserTypeDto } from './dto/update-user-type.dto';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminForgotPasswordDto } from './dto/admin-forgot-password.dto';
import { AdminResendOtpDto } from './dto/admin-resend-otp.dto';
import { AdminVerifyOtpDto } from './dto/admin-verify-otp.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { AdminChangePasswordDto } from './dto/admin-change-password.dto';
import { DeleteUserDto } from './dto/delete-user.dto';
import { DeleteDeckByIdDto } from './dto/delete-deck-by-id.dto';
import { UpdateUserSubscriptionExpiryDto } from './dto/update-user-subscription-expiry.dto';

@ApiTags('Admin Controller')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) { }

  // Public Admin Authentication Endpoints (No Auth Required)
  @Post('login')
  @ApiOperation({
    summary: 'Admin login',
    description: 'Authenticates an admin user with email and password. Returns JWT access token and admin information.',
  })
  @ApiBody({ type: AdminLoginDto })
  @ApiResponse({
    status: 200,
    description: 'Admin login successful. Returns access token and admin data.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid email or password',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid input or admin not found',
  })
  async adminLogin(@Body() adminLoginDto: AdminLoginDto) {
    return this.adminService.adminLogin(adminLoginDto);
  }

  @Post('forgot-password')
  @ApiOperation({
    summary: 'Request admin password reset',
    description: 'Initiates the password reset process for admin by sending an OTP to the admin\'s email address. Admin must verify the OTP before resetting the password.',
  })
  @ApiBody({ type: AdminForgotPasswordDto })
  @ApiResponse({
    status: 200,
    description: 'Password reset OTP sent to email successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Admin not found with the provided email',
  })
  async adminForgotPassword(@Body() adminForgotPasswordDto: AdminForgotPasswordDto) {
    return this.adminService.adminForgotPassword(adminForgotPasswordDto);
  }

  @Post('resend-otp')
  @ApiOperation({
    summary: 'Resend OTP for admin',
    description: 'Resends the OTP (One-Time Password) to the admin\'s email address. Useful when the original OTP expires or was not received.',
  })
  @ApiBody({ type: AdminResendOtpDto })
  @ApiResponse({
    status: 200,
    description: 'OTP resent to email successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Admin not found with the provided email',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - no active password reset request or invalid input',
  })
  async adminResendOtp(@Body() adminResendOtpDto: AdminResendOtpDto) {
    return this.adminService.adminResendOtp(adminResendOtpDto);
  }

  @Post('verify-otp')
  @ApiOperation({
    summary: 'Verify OTP for admin',
    description: 'Verifies the OTP sent to the admin\'s email. Used for password reset process.',
  })
  @ApiBody({ type: AdminVerifyOtpDto })
  @ApiResponse({
    status: 200,
    description: 'OTP verified successfully.',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid or expired OTP',
  })
  @ApiResponse({
    status: 404,
    description: 'Admin not found with the provided email',
  })
  async adminVerifyOtp(@Body() adminVerifyOtpDto: AdminVerifyOtpDto) {
    return this.adminService.adminVerifyOtp(adminVerifyOtpDto);
  }

  @Post('reset-password')
  @ApiOperation({
    summary: 'Reset admin password',
    description: 'Resets the admin\'s password after OTP verification. Requires the admin to have verified the OTP sent to their email. Password and confirmPassword must match.',
  })
  @ApiBody({ type: AdminResetPasswordDto })
  @ApiResponse({
    status: 200,
    description: 'Password reset successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - passwords do not match, OTP not verified, or invalid input',
  })
  @ApiResponse({
    status: 404,
    description: 'Admin not found with the provided email',
  })
  async adminResetPassword(@Body() adminResetPasswordDto: AdminResetPasswordDto) {
    return this.adminService.adminResetPassword(adminResetPasswordDto);
  }

  // Protected Admin Endpoints (Auth Required)
  @Get('users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @Roles(USER_ROLE[0])
  @ApiOperation({
    summary: 'Get all users',
    description: 'Admin only. Retrieves a paginated list of all users in the system.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Optional search string to match user name or email (partial, case-insensitive).',
  })
  @ApiQuery({
    name: 'userType',
    required: false,
    type: String,
    description: 'Optional userType filter (exact match, case-insensitive).',
  })
  @ApiQuery({
    name: 'subscriptionType',
    required: false,
    type: String,
    description: 'Optional subscriptionType filter (exact match) to return users who purchased plans of this type.',
  })
  @ApiQuery({
    name: 'teamPlan',
    required: false,
    type: String,
    description: "Optional teamPlan filter (e.g. 'enterprise') to return enterprise team users.",
  })
  @ApiResponse({
    status: 200,
    description: 'List of users retrieved successfully',
  })
  async findAll(@Query() query: { page?: number; limit?: number; search?: string; userType?: string; subscriptionType?: string; teamPlan?: string }) {
    return await this.adminService.findAll(query);
  }

  @Get('users/with-purchases')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @Roles(USER_ROLE[0])
  @ApiOperation({
    summary: 'Get users who purchased plans',
    description: 'Admin only. Retrieves paginated users that have purchased subscription plans along with plan status.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page',
  })
  @ApiQuery({
    name: 'subscriptionType',
    required: false,
    type: String,
    description: 'Optional subscriptionType filter (exact match, e.g. month, year, 14day, lives, coins) to return users who purchased plans of this type.',
  })
  @ApiResponse({
    status: 200,
    description: 'Users with purchases retrieved successfully',
  })
  async getUsersWithPurchases(@Query() query: { page?: number; limit?: number; subscriptionType?: string }) {
    return await this.adminService.getUsersWithPurchases(query);
  }

  @Patch('enterprise/update-status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @Roles(USER_ROLE[0])
  @ApiOperation({
    summary: 'Update enterprise user status',
    description: 'Admin only. Updates the status of enterprise user registrations (approve/reject).',
  })
  @ApiBody({ type: UpdateStatusEnterpriseDto })
  @ApiResponse({
    status: 200,
    description: 'Enterprise user status updated successfully',
  })
  async updateStatusEnterprise(
    @Body() updateStatusEnterpriseDto: UpdateStatusEnterpriseDto,
  ) {
    return await this.adminService.updateStatusEnterprise(
      updateStatusEnterpriseDto,
    );
  }

  @Get('enterprise/pending-registrations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @Roles(USER_ROLE[0])
  @ApiOperation({
    summary: 'Get all enterprise pending registrations',
    description: 'Admin only. Retrieves a paginated list of all enterprise user registrations that are pending approval.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page',
  })
  @ApiResponse({
    status: 200,
    description: 'Enterprise pending registrations retrieved successfully',
  })
  async getAllUsersContentFileData(
    @Query() query: { page?: number; limit?: number },
  ) {
    return await this.adminService.getAllUsersContentFileData(query);
  }

  @Get('deck/public-requests')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @Roles(USER_ROLE[0])
  @ApiOperation({
    summary: 'Get all public access requests',
    description: 'Admin only. Returns all decks where isPublic=true and status=pending. Only accessible to users with admin role.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of public access requests retrieved successfully',
  })
  async getPublicRequests() {
    return this.adminService.getPublicRequests();
  }

  @Post('deck/:deckId/approve-public')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @Roles(USER_ROLE[0])
  @ApiOperation({
    summary: 'Approve or reject public access request for a deck',
    description: 'Admin only. Approves or rejects a deck public access request. If status=approve, sets status=approve and isPublic=true. If status=reject, sets status=reject and isPublic=false.',
  })
  @ApiParam({
    name: 'deckId',
    type: String,
    description: 'Deck ID to approve or reject',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['status'],
      properties: {
        status: {
          type: 'string',
          enum: ['approve', 'reject'],
          description: 'Status to set: approve or reject',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Public access request processed successfully',
  })
  async approvePublicRequest(
    @Param('deckId') deckId: string,
    @Body('status') status: 'approve' | 'reject',
  ) {
    if (!deckId) {
      throw new BadRequestException('deckId is required');
    }
    if (!status) {
      throw new BadRequestException('status is required');
    }
    return this.adminService.approvePublicRequest(deckId, status);
  }

  @Patch('users/toggle-status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @Roles(USER_ROLE[0])
  @ApiOperation({
    summary: 'Toggle user block status',
    description: 'Admin only. Toggles the block status of a user. When isBlocked=true, user cannot access anything.',
  })
  @ApiBody({ type: ToggleUserStatusDto })
  @ApiResponse({
    status: 200,
    description: 'User block status updated successfully',
  })
  async toggleUserStatus(@Body() toggleUserStatusDto: ToggleUserStatusDto) {
    return await this.adminService.toggleUserStatus(toggleUserStatusDto);
  }

  @Patch('users/update-type')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @Roles(USER_ROLE[0])
  @ApiOperation({
    summary: 'Update user type',
    description: 'Admin only. Updates the userType of a user.',
  })
  @ApiBody({ type: UpdateUserTypeDto })
  @ApiResponse({
    status: 200,
    description: 'User type updated successfully',
  })
  async updateUserType(@Body() updateUserTypeDto: UpdateUserTypeDto) {
    return await this.adminService.updateUserType(updateUserTypeDto);
  }

  @Get('content-file-data')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @Roles(USER_ROLE[0])
  @ApiOperation({
    summary: 'Get all content file data',
    description: 'Admin only. Retrieves a paginated list of all content file data with optional status filter.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    type: String,
    enum: ['approved', 'pending'],
    description: 'Optional status filter (approved or pending)',
  })
  @ApiResponse({
    status: 200,
    description: 'Content file data retrieved successfully',
  })
  async getContentFileData(
    @Query() query: { page?: number; limit?: number; status?: 'approved' | 'pending' },
  ) {
    return await this.adminService.getContentFileData(query);
  }

  @Get('deck/public-approved')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @Roles(USER_ROLE[0])
  @ApiOperation({
    summary: 'Get all public approved decks',
    description: 'Admin only. Retrieves a paginated list of decks where isPublic=true and status=approve with optional search by deck name.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Optional search string to match deck name (partial, case-insensitive).',
  })
  @ApiResponse({
    status: 200,
    description: 'Public approved decks retrieved successfully',
  })
  async getPublicApprovedDecks(
    @Query() query: { page?: number; limit?: number; search?: string },
  ) {
    return await this.adminService.getPublicApprovedDecks(query);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @Roles(USER_ROLE[0])
  @ApiOperation({
    summary: 'Change admin password',
    description: 'Allows the authenticated admin to change their password by providing the old password and new password.',
  })
  @ApiBody({ type: AdminChangePasswordDto })
  @ApiResponse({
    status: 200,
    description: 'Password changed successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid old password or bad request',
  })
  async changePassword(@Req() req, @Body() adminChangePasswordDto: AdminChangePasswordDto) {
    const adminId = req.user.id;
    return await this.adminService.changePassword(adminId, adminChangePasswordDto);
  }

  @Delete('users/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @Roles(USER_ROLE[0])
  @ApiOperation({
    summary: 'Delete user',
    description: 'Admin only. Deletes a user by userId along with all associated data including decks, topics, subtopics, games, game progress, user games, battle games, team games, and content.',
  })
  @ApiParam({
    name: 'userId',
    type: String,
    description: 'User ID to delete',
  })
  @ApiResponse({
    status: 200,
    description: 'User and all related data deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid user ID format',
  })
  async deleteUser(@Param('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }
    const deleteUserDto: DeleteUserDto = { userId };
    return await this.adminService.deleteUser(deleteUserDto);
  }

  @Delete('deck/:deckId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @Roles(USER_ROLE[0])
  @ApiOperation({
    summary: 'Delete deck',
    description: 'Admin only. Deletes a deck by deckId along with all its topics and subtopics.',
  })
  @ApiParam({
    name: 'deckId',
    type: String,
    description: 'Deck ID to delete',
  })
  @ApiResponse({
    status: 200,
    description: 'Deck and all related content (topics and subtopics) deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Deck not found',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid deck ID format',
  })
  async deleteDeck(@Param('deckId') deckId: string) {
    if (!deckId) {
      throw new BadRequestException('deckId is required');
    }
    const deleteDeckByIdDto: DeleteDeckByIdDto = { deckId };
    return await this.adminService.deleteDeckById(deleteDeckByIdDto);
  }

  @Patch('users/update-subscription-expiry')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @Roles(USER_ROLE[0])
  @ApiOperation({
    summary: 'Update user subscription expiry date',
    description: 'Admin only. Updates the subscription expiry date for a user by userId.',
  })
  @ApiBody({ type: UpdateUserSubscriptionExpiryDto })
  @ApiResponse({
    status: 200,
    description: 'User subscription expiry date updated successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid user ID or expiry date format',
  })
  async updateSubscriptionExpiry(@Body() updateUserSubscriptionExpiryDto: UpdateUserSubscriptionExpiryDto) {
    return await this.adminService.updateUserSubscriptionExpiry(updateUserSubscriptionExpiryDto);
  }

  @Get('deck/:deckId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @Roles(USER_ROLE[0])
  @ApiOperation({
    summary: 'Get deck by ID with all details',
    description: 'Admin only. Retrieves a deck by deckId with all its topics and subtopics populated.',
  })
  @ApiParam({
    name: 'deckId',
    type: String,
    description: 'Deck ID to retrieve',
  })
  @ApiResponse({
    status: 200,
    description: 'Deck retrieved successfully with all topics and subtopics',
  })
  @ApiResponse({
    status: 404,
    description: 'Deck not found',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid deck ID format',
  })
  async getDeckById(@Param('deckId') deckId: string) {
    if (!deckId) {
      throw new BadRequestException('deckId is required');
    }
    return await this.adminService.getDeckByIdWithDetails(deckId);
  }
}
