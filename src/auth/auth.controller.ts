import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginDto } from './dto/create-login.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { CreateEnterpriseUserDto } from './dto/create-enterprise-user.dto';

@ApiTags('Auth Controller')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register a new user',
    description: 'Creates a new user account with email and password. An OTP will be sent to the email for verification. User starts with 50 lives and 100 points.',
  })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({
    status: 201,
    description: 'User registered successfully. OTP sent to email.',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - email already exists or invalid input',
  })
  async create(@Body() createUserDto: CreateUserDto) {
    return this.authService.create(createUserDto);
  }

  @Post('enterprise-register')
  @ApiOperation({
    summary: 'Register an enterprise user',
    description: 'Registers a new enterprise user. The registration will be pending until approved by an admin. Enterprise users need admin approval before they can access the system.',
  })
  @ApiBody({ type: CreateEnterpriseUserDto })
  @ApiResponse({
    status: 201,
    description: 'Enterprise user registration submitted successfully. Pending admin approval.',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - email already registered or invalid input',
  })
  async createEnterpriseUser(@Body() createEnterpriseUserDto: CreateEnterpriseUserDto) {
    return this.authService.createEnterpriseUser(createEnterpriseUserDto);
  }

  // @Post('admin-register')
  // async adminRegister(@Body() createUserDto: CreateUserDto) {
  //   return this.authService.adminRegister(createUserDto);
  // }

  // @Post('member-register')
  // async memberRegister(@Body() createUserDto: CreateUserDto) {
  //   return this.authService.memberRegister(createUserDto);
  // }

  @Post('login')
  @ApiOperation({
    summary: 'User login',
    description: 'Authenticates a user with email and password. Returns JWT access token and user information. Optionally accepts FCM token for push notifications.',
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description: 'Login successful. Returns access token and user data.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid email or password',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid input or user not verified',
  })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('forgot-password')
  @ApiOperation({
    summary: 'Request password reset',
    description: 'Initiates the password reset process by sending an OTP to the user\'s email address. User must verify the OTP before resetting the password.',
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiResponse({
    status: 200,
    description: 'Password reset OTP sent to email successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found with the provided email',
  })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Post('resend-otp')
  @ApiOperation({
    summary: 'Resend OTP',
    description: 'Resends the OTP (One-Time Password) to the user\'s email address. Useful when the original OTP expires or was not received.',
  })
  @ApiBody({ type: ResendOtpDto })
  @ApiResponse({
    status: 200,
    description: 'OTP resent to email successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found with the provided email',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - user already verified or invalid input',
  })
  async resendOtp(@Body() resendOtpDto: ResendOtpDto) {
    return this.authService.resendOtp(resendOtpDto);
  }

  @Post('verify-otp')
  @ApiOperation({
    summary: 'Verify OTP',
    description: 'Verifies the OTP sent to the user\'s email. Used for email verification during registration or password reset process.',
  })
  @ApiBody({ type: VerifyOtpDto })
  @ApiResponse({
    status: 200,
    description: 'OTP verified successfully. User email is now verified.',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid or expired OTP',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found with the provided email',
  })
  async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.authService.verifyOtp(verifyOtpDto);
  }

  @Post('reset-password')
  @ApiOperation({
    summary: 'Reset password',
    description: 'Resets the user\'s password after OTP verification. Requires the user to have verified the OTP sent to their email. Password and confirmPassword must match.',
  })
  @ApiBody({ type: ResetPasswordDto })
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
    description: 'User not found with the provided email',
  })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }
}
