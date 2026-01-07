import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, Schema as MongooseSchema } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { MailService } from '../common/mail.service';
import { User, UserDocument } from 'src/users/entities/user.entity';
import type { CreateUserDto } from './dto/create-user.dto';
import type { ForgotPasswordDto } from './dto/forgot-password.dto';
import type { VerifyOtpDto } from './dto/verify-otp.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';
import { LoginDto } from './dto/create-login.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { AdminCreation } from '../organization/entities/admin-creation.entity';
import { TeamMember } from '../organization/entities/team-member.entity';
import { ContentFileData } from '../organization/entities/content-file-data.entity';
import type { CreateEnterpriseUserDto } from './dto/create-enterprise-user.dto';
import {
  GameProgress,
  GameProgressDocument,
} from '../content/schemas/game-progress.schema';
import {
  TempRegistration,
  TempRegistrationDocument,
} from './schemas/temp-registration.schema';
import { generateJwtToken, OTP_FUNCTION, OTPGNARETE } from '../common/utils';
import { USER_TYPE } from 'src/common/enum';

@Injectable()
export class AuthService {
  private readonly freeEmailDomains = [
    'gmail.com',
    'yahoo.com',
    'hotmail.com',
    'outlook.com',
    'live.com',
    'rediffmail.com',
    'icloud.com',
    'zoho.com',
    'mail.com',
    'aol.com',
    'gmx.com',
    'protonmail.com',
    'proton.me',
    'yandex.com',
    'tutanota.com',
    'fastmail.com',
    'example.com',
  ];

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(AdminCreation.name)
    private readonly adminCreationModel: Model<AdminCreation>,
    @InjectModel(TeamMember.name)
    private readonly teamMemberModel: Model<TeamMember>,
    @InjectModel(ContentFileData.name)
    private readonly contentFileDataModel: Model<ContentFileData>,
    @InjectModel(GameProgress.name)
    private readonly gameProgressModel: Model<GameProgressDocument>,
    @InjectModel(TempRegistration.name)
    private readonly tempRegistrationModel: Model<TempRegistrationDocument>,
    private readonly mailService: MailService,
  ) {}

  async create(createUserDto: CreateUserDto) {
    try {
      const existingUserByEmail = await this.userModel.findOne({
        email: createUserDto.email,
      });

      if (existingUserByEmail) {
        throw new BadRequestException('This email is already registered.');
      }

      const existingUserByPhone = await this.userModel.findOne({
        contactNumber: createUserDto.contactNumber,
      });

      if (existingUserByPhone) {
        throw new BadRequestException(
          'This phone number is already registered.',
        );
      }

      // Check for pending admin invitation
      const pendingAdmin = await this.adminCreationModel.findOne({
        email: createUserDto.email,
        status: 'pending',
      });

      // Check for pending team member invitation
      const pendingTeamMember = await this.teamMemberModel.findOne({
        email: createUserDto.email,
        status: 'pending',
      });

      // Determine inviter's teamPlan for admin or team member invitations (used to inherit enterprise plan)
      let inviterTeamPlan: string | null = null;
      const inviterId = pendingAdmin?.creator ?? pendingTeamMember?.creator;
      if (inviterId) {
        const inviter = await this.userModel.findById(inviterId);
        if (
          inviter &&
          (inviter.userType === USER_TYPE[1] ||
            inviter.userType === USER_TYPE[2]) &&
          inviter.teamPlan
        ) {
          const normalized = String(inviter.teamPlan).toLowerCase();
          if (normalized === 'enterprise') {
            inviterTeamPlan = 'enterprise';
          }
        }
      }

      // Determine userType based on pending invitations or superAdmin status
      // Priority: pendingAdmin > pendingTeamMember > superAdmin (if no birth fields) > individual
      const isMissingBirthFields =
        !createUserDto.monthOfBirth && !createUserDto.yearOfBirth;
      const userType = pendingAdmin
        ? USER_TYPE[2]
        : pendingTeamMember
          ? USER_TYPE[3]
          : isMissingBirthFields
            ? USER_TYPE[1]
            : USER_TYPE[0];

      // Generate and send OTP if userType is individual OR monthOfBirth or yearOfBirth is not provided
      let registrationOtp: number | null = null;
      let otpExpires: Date | null = null;
      const requiresOtp =
        userType === USER_TYPE[0] ||
        !createUserDto.monthOfBirth ||
        !createUserDto.yearOfBirth;

      // Check if email domain is in free email domains list (only when birth fields are missing)
      // This check should NOT apply when user provides both monthOfBirth and yearOfBirth
      const isAnyBirthFieldMissing =
        !createUserDto.monthOfBirth || !createUserDto.yearOfBirth;
      if (
        isAnyBirthFieldMissing &&
        (userType === USER_TYPE[0] || userType === USER_TYPE[1])
      ) {
        const emailDomain = createUserDto.email.split('@')[1]?.toLowerCase();
        if (emailDomain && this.freeEmailDomains.includes(emailDomain)) {
          throw new BadRequestException(
            'Only business emails are allowed. Please use a business email address.',
          );
        }
      }

      if (requiresOtp) {
        registrationOtp = OTPGNARETE();
        otpExpires = OTP_FUNCTION.getOtpExpiryDate();
      }

      const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

      // Check for existing temp registration
      const existingTempRegistration = await this.tempRegistrationModel.findOne(
        {
          email: createUserDto.email,
        },
      );

      // If temp registration exists and OTP is required, resend OTP
      if (
        existingTempRegistration &&
        requiresOtp &&
        registrationOtp &&
        otpExpires
      ) {
        // Prepare updated temp registration data
        const tempRegistrationData: Record<string, unknown> = {
          ...createUserDto,
          password: hashedPassword,
          name: createUserDto.name ?? null,
          userType:
            userType === USER_TYPE[1]
              ? USER_TYPE[1]
              : userType === USER_TYPE[0]
                ? USER_TYPE[0]
                : 'organization',
          teamPlan: inviterTeamPlan,
          monthOfBirth: createUserDto.monthOfBirth ?? null,
          yearOfBirth: createUserDto.yearOfBirth ?? null,
          otp: registrationOtp,
          otpSendDate: otpExpires,
          organization: null,
          pendingAdminId: pendingAdmin?._id?.toString() || null,
          pendingTeamMemberId: pendingTeamMember?._id?.toString() || null,
        };

        // If there's a pending admin invitation
        if (pendingAdmin) {
          tempRegistrationData.userType = USER_TYPE[2];
          if (pendingAdmin.organization) {
            tempRegistrationData.organization = pendingAdmin.organization;
          }
        } else if (pendingTeamMember) {
          tempRegistrationData.userType = USER_TYPE[3];
          if (pendingTeamMember.organization) {
            tempRegistrationData.organization = pendingTeamMember.organization;
          }
        }

        // Update existing temp registration with new data and OTP
        Object.assign(existingTempRegistration, tempRegistrationData);
        await existingTempRegistration.save();

        // Resend OTP email

        this.mailService.sendRegisteringEmail(
          createUserDto.email,
          createUserDto.name || createUserDto.email || 'User',
          registrationOtp,
        );
        return {
          statusCode: HttpStatus.OK,
          message:
            'OTP has been resent to your email. Please verify to complete registration.',
        };
      }

      // If temp registration exists but OTP is not required, delete it and continue
      if (existingTempRegistration && !requiresOtp) {
        await this.tempRegistrationModel.deleteOne({
          email: createUserDto.email,
        });
      }

      // If OTP is required and no temp registration exists, store in temp registration instead of creating user
      if (
        requiresOtp &&
        registrationOtp &&
        otpExpires &&
        !existingTempRegistration
      ) {
        // Prepare temp registration data
        const tempRegistrationData: Record<string, unknown> = {
          ...createUserDto,
          password: hashedPassword,
          name: createUserDto.name ?? null,
          userType:
            userType === USER_TYPE[1]
              ? USER_TYPE[1]
              : userType === USER_TYPE[0]
                ? USER_TYPE[0]
                : 'organization',
          teamPlan: inviterTeamPlan,
          monthOfBirth: createUserDto.monthOfBirth ?? null,
          yearOfBirth: createUserDto.yearOfBirth ?? null,
          otp: registrationOtp,
          otpSendDate: otpExpires,
          organization: null,
          pendingAdminId: pendingAdmin?._id?.toString() || null,
          pendingTeamMemberId: pendingTeamMember?._id?.toString() || null,
        };

        // If there's a pending admin invitation
        if (pendingAdmin) {
          tempRegistrationData.userType = USER_TYPE[2];
          if (pendingAdmin.organization) {
            tempRegistrationData.organization = pendingAdmin.organization;
          }
        } else if (pendingTeamMember) {
          tempRegistrationData.userType = USER_TYPE[3];
          if (pendingTeamMember.organization) {
            tempRegistrationData.organization = pendingTeamMember.organization;
          }
        }

        // Store in temp registration
        await this.tempRegistrationModel.create(tempRegistrationData);

        // Send OTP email
        try {
          this.mailService.sendRegisteringEmail(
            createUserDto.email,
            createUserDto.name || createUserDto.email || 'User',
            registrationOtp,
          );
        } catch (mailError) {
          // If email fails, delete temp registration
          await this.tempRegistrationModel.deleteOne({
            email: createUserDto.email,
          });
          throw new BadRequestException(
            'Failed to send OTP email. Please try again.',
          );
        }

        return {
          statusCode: HttpStatus.OK,
          message:
            'OTP has been sent to your email. Please verify to complete registration.',
        };
      }

      // If OTP is not required, create user directly
      const userData: Record<string, unknown> = {
        ...createUserDto,
        password: hashedPassword,
        name: createUserDto.name ?? null,
        userType:
          userType === USER_TYPE[1]
            ? USER_TYPE[1]
            : userType === USER_TYPE[0]
              ? USER_TYPE[0]
              : 'organization',
        teamPlan: inviterTeamPlan,
        monthOfBirth: createUserDto.monthOfBirth ?? null,
        yearOfBirth: createUserDto.yearOfBirth ?? null,
      };

      // If there's a pending admin invitation
      if (pendingAdmin) {
        // Check admin limit before registration
        if (pendingAdmin.organization) {
          const actualAdminCount = await this.userModel.countDocuments({
            userType: USER_TYPE[2],
            organization: pendingAdmin.organization,
          });

          if (actualAdminCount >= 3) {
            pendingAdmin.status = 'rejected';
            await pendingAdmin.save();
            throw new BadRequestException(
              'Maximum of 3 admin users reached for this organization. Registration cannot be completed.',
            );
          }
        }

        userData.userType = USER_TYPE[2];
        if (pendingAdmin.organization) {
          userData.organization = pendingAdmin.organization;
        }
      } else if (pendingTeamMember) {
        // If there's a pending team member invitation
        userData.userType = USER_TYPE[3];
        if (pendingTeamMember.organization) {
          userData.organization = pendingTeamMember.organization;
        }
      }

      // If userType is superAdmin, add subscription with 14day plan
      if (userData.userType === USER_TYPE[1]) {
        const subscriptionId = new Types.ObjectId('693a5354e1607999d1a494ae');
        const startDate = new Date();
        const expireDate = new Date(startDate);
        expireDate.setDate(expireDate.getDate() + 14);

        userData.purchasePlanId = subscriptionId;
        userData.purchasePlanType = '14day';
        userData.startPlanDate = startDate;
        userData.expirePlanDate = expireDate;
        userData.isPayment = true;
      }

      const newUser = await this.userModel.create(userData);

      // Create game progress with 50 lives and 100 points
      await this.gameProgressModel.create({
        userId: newUser._id.toString(),
        lives: 50,
        points: 100,
      });

      // Update pending invitation status if exists
      if (pendingAdmin) {
        pendingAdmin.status = 'approved';
        pendingAdmin.createdAdmin =
          newUser._id as unknown as MongooseSchema.Types.ObjectId;
        await pendingAdmin.save();
      }

      if (pendingTeamMember) {
        pendingTeamMember.status = 'approved';
        pendingTeamMember.user =
          newUser._id as unknown as MongooseSchema.Types.ObjectId;
        await pendingTeamMember.save();
      }

      const token = generateJwtToken(newUser);

      return {
        statusCode: HttpStatus.CREATED,
        message: 'Registration successful!',
        data: { user: this.sanitizeUser(newUser), token },
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  async login(loginDto: LoginDto) {
    try {
      const { email, password } = loginDto;

      const user = await this.userModel.findOne({ email });

      if (!user) throw new BadRequestException('User not found.');

      // Check if user is blocked
      if (user.isBlocked === true) {
        throw new UnauthorizedException('Your account is blocked');
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) throw new BadRequestException('Password does not match.');

      const token = generateJwtToken(user);

      user.isOnline = true;
      user.isActive = true;
      await user.save();
      return {
        statusCode: HttpStatus.OK,
        message: 'Login successful!',
        data: { user: this.sanitizeUser(user), token },
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    try {
      const user = await this.userModel.findOne({
        email: forgotPasswordDto.email,
      });

      if (!user) throw new NotFoundException('User not found.');

      const otp = OTPGNARETE();
      const otpExpires = OTP_FUNCTION.getOtpExpiryDate();

      user.otp = otp;
      user.otpSendDate = otpExpires;
      user.forgotPassword = true;
      user.verifyOtp = false;
      await user.save();

      this.mailService.sendOtpEmail(
        user.email,
        user.name || user.email || 'User',
        otp,
      );

      return {
        statusCode: HttpStatus.OK,
        message: 'OTP has been sent to your email.',
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async resendOtp(resendOtpDto: ResendOtpDto) {
    try {
      // First check for temp registration (registration OTP)
      const tempRegistration = await this.tempRegistrationModel.findOne({
        email: resendOtpDto.email,
      });

      if (tempRegistration) {
        // Check if OTP is still valid
        if (tempRegistration.otpSendDate > new Date()) {
          const minutesLeft = Math.ceil(
            (tempRegistration.otpSendDate.getTime() - new Date().getTime()) /
              60000,
          );
          throw new BadRequestException(
            `OTP is still valid. Try again in ${minutesLeft} minute(s).`,
          );
        }

        // Generate new OTP
        const otp = OTPGNARETE();
        const otpExpires = OTP_FUNCTION.getOtpExpiryDate();

        tempRegistration.otp = otp;
        tempRegistration.otpSendDate = otpExpires;
        await tempRegistration.save();

        this.mailService.sendOtpEmail(
          tempRegistration.email,
          tempRegistration.name || tempRegistration.email || 'User',
          otp,
        );

        return {
          statusCode: HttpStatus.OK,
          message: 'New OTP has been sent to your email.',
        };
      }

      // If no temp registration, check for existing user (forgot password OTP)
      const user = await this.userModel.findOne({ email: resendOtpDto.email });

      if (!user) throw new NotFoundException('User not found.');

      if (!user.otp || !user.otpSendDate || !user.forgotPassword) {
        throw new BadRequestException(
          'No active password reset request found.',
        );
      }

      if (user.otpSendDate > new Date()) {
        const minutesLeft = Math.ceil(
          (user.otpSendDate.getTime() - new Date().getTime()) / 60000,
        );
        throw new BadRequestException(
          `OTP is still valid. Try again in ${minutesLeft} minute(s).`,
        );
      }

      const otp = OTPGNARETE();
      const otpExpires = OTP_FUNCTION.getOtpExpiryDate();

      user.otp = otp;
      user.otpSendDate = otpExpires;
      user.verifyOtp = false;
      await user.save();

      this.mailService.sendOtpEmail(
        user.email,
        user.name || user.email || 'User',
        otp,
      );

      return {
        statusCode: HttpStatus.OK,
        message: 'New OTP has been sent to your email.',
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async verifyOtp(verifyOtpDto: VerifyOtpDto) {
    try {
      // First check for temp registration (registration OTP)
      const tempRegistration = await this.tempRegistrationModel.findOne({
        email: verifyOtpDto.email,
      });

      if (tempRegistration) {
        // Verify OTP for registration
        if (
          !tempRegistration.otpSendDate ||
          tempRegistration.otpSendDate <= new Date()
        ) {
          throw new BadRequestException(
            'OTP expired. Please request a new one.',
          );
        }

        if (tempRegistration.otp !== Number(verifyOtpDto.otp)) {
          throw new BadRequestException('Invalid OTP.');
        }

        // Check for pending admin invitation
        let pendingAdmin: AdminCreation | null = null;
        if (tempRegistration.pendingAdminId) {
          pendingAdmin = await this.adminCreationModel.findById(
            tempRegistration.pendingAdminId,
          );
        }

        // Check for pending team member invitation
        let pendingTeamMember: TeamMember | null = null;
        if (tempRegistration.pendingTeamMemberId) {
          pendingTeamMember = await this.teamMemberModel.findById(
            tempRegistration.pendingTeamMemberId,
          );
        }

        // Check admin limit if pending admin
        if (pendingAdmin && pendingAdmin.organization) {
          const actualAdminCount = await this.userModel.countDocuments({
            userType: USER_TYPE[2],
            organization: pendingAdmin.organization,
          });

          if (actualAdminCount >= 3) {
            await this.tempRegistrationModel.deleteOne({
              email: verifyOtpDto.email,
            });
            if (pendingAdmin) {
              pendingAdmin.status = 'rejected';
              await pendingAdmin.save();
            }
            throw new BadRequestException(
              'Maximum of 3 admin users reached for this organization. Registration cannot be completed.',
            );
          }
        }

        // Check if user already exists (in case someone registered with same email/phone between registration and OTP verification)
        const existingUserByEmail = await this.userModel.findOne({
          email: tempRegistration.email,
        });
        if (existingUserByEmail) {
          await this.tempRegistrationModel.deleteOne({
            email: verifyOtpDto.email,
          });
          throw new BadRequestException('This email is already registered.');
        }

        const existingUserByPhone = await this.userModel.findOne({
          contactNumber: tempRegistration.contactNumber,
        });
        if (existingUserByPhone) {
          await this.tempRegistrationModel.deleteOne({
            email: verifyOtpDto.email,
          });
          throw new BadRequestException(
            'This phone number is already registered.',
          );
        }

        // Create user from temp registration data
        const userData: Record<string, unknown> = {
          name: tempRegistration.name,
          contactNumber: tempRegistration.contactNumber,
          email: tempRegistration.email,
          password: tempRegistration.password,
          countryCode: tempRegistration.countryCode,
          monthOfBirth: tempRegistration.monthOfBirth,
          yearOfBirth: tempRegistration.yearOfBirth,
          userType: tempRegistration.userType,
          teamPlan: tempRegistration.teamPlan,
          organization: tempRegistration.organization,
        };

        // If userType is superAdmin, add subscription with 14day plan
        if (userData.userType === USER_TYPE[1]) {
          const subscriptionId = new Types.ObjectId('693a5354e1607999d1a494ae');
          const startDate = new Date();
          const expireDate = new Date(startDate);
          expireDate.setDate(expireDate.getDate() + 14);

          userData.purchasePlanId = subscriptionId;
          userData.purchasePlanType = '14day';
          userData.startPlanDate = startDate;
          userData.expirePlanDate = expireDate;
          userData.isPayment = true;
        }

        const newUser = await this.userModel.create(userData);

        // Create game progress with 50 lives and 100 points
        await this.gameProgressModel.create({
          userId: newUser._id.toString(),
          lives: 50,
          points: 100,
        });

        // Update pending invitation status if exists
        if (pendingAdmin) {
          pendingAdmin.status = 'approved';
          pendingAdmin.createdAdmin =
            newUser._id as unknown as MongooseSchema.Types.ObjectId;
          await pendingAdmin.save();
        }

        if (pendingTeamMember) {
          pendingTeamMember.status = 'approved';
          pendingTeamMember.user =
            newUser._id as unknown as MongooseSchema.Types.ObjectId;
          await pendingTeamMember.save();
        }

        // Delete temp registration
        await this.tempRegistrationModel.deleteOne({
          email: verifyOtpDto.email,
        });

        const token = generateJwtToken(newUser);

        return {
          statusCode: HttpStatus.OK,
          message: 'OTP verified successfully. Registration completed!',
          data: { user: this.sanitizeUser(newUser), token, isValid: true },
        };
      }

      // If no temp registration, check for existing user (forgot password OTP)
      const user = await this.userModel.findOne({ email: verifyOtpDto.email });

      if (!user) {
        throw new NotFoundException('User not found. Please register first.');
      }

      // Check if it's a forgot password OTP
      if (!user.forgotPassword) {
        throw new BadRequestException(
          'No active OTP request found. Please request an OTP first.',
        );
      }

      if (!user.otpSendDate || user.otpSendDate <= new Date()) {
        throw new BadRequestException('OTP expired. Please request a new one.');
      }

      if (user.otp !== Number(verifyOtpDto.otp)) {
        throw new BadRequestException('Invalid OTP.');
      }

      user.verifyOtp = true;
      await user.save();

      return {
        statusCode: HttpStatus.OK,
        message: 'OTP verified successfully.',
        data: { isValid: true },
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    try {
      if (resetPasswordDto.password !== resetPasswordDto.confirmPassword) {
        throw new BadRequestException('Passwords must match.');
      }

      const user = await this.userModel.findOne({
        email: resetPasswordDto.email,
      });

      if (!user)
        throw new BadRequestException('Invalid password reset request.');
      if (!user.forgotPassword)
        throw new BadRequestException(
          'Please initiate the forgot password process first.',
        );
      if (!user.verifyOtp) {
        throw new BadRequestException('OTP verification required.');
      }

      const hashedPassword = await bcrypt.hash(resetPasswordDto.password, 10);

      user.password = hashedPassword;
      user.otp = null;
      user.otpSendDate = null;
      user.forgotPassword = false;
      user.verifyOtp = false;

      await user.save();

      return {
        statusCode: HttpStatus.OK,
        message: 'Password reset successfully.',
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async createEnterpriseUser(createEnterpriseUserDto: CreateEnterpriseUserDto) {
    try {
      // Check if email already exists in ContentFileData
      const existingRegistration = await this.contentFileDataModel.findOne({
        email: createEnterpriseUserDto.email,
      });

      if (existingRegistration) {
        throw new BadRequestException('This email is already registered.');
      }

      const existingRegistrationByPhone =
        await this.contentFileDataModel.findOne({
          contactNumber: createEnterpriseUserDto.contactNumber,
        });

      if (existingRegistrationByPhone) {
        throw new BadRequestException(
          'This phone number is already registered.',
        );
      }

      // Check if email domain is in free email domains list
      const emailDomain = createEnterpriseUserDto.email
        .split('@')[1]
        ?.toLowerCase();
      if (emailDomain && this.freeEmailDomains.includes(emailDomain)) {
        throw new BadRequestException(
          'Only business emails are allowed. Please use a business email address.',
        );
      }

      // Save registration data to ContentFileData only
      const contentFileData = await this.contentFileDataModel.create({
        firstName: createEnterpriseUserDto.firstName,
        lastName: createEnterpriseUserDto.lastName,
        contactNumber: createEnterpriseUserDto.contactNumber,
        organizationName: createEnterpriseUserDto.organizationName,
        email: createEnterpriseUserDto.email,
        city: createEnterpriseUserDto.city,
        country: createEnterpriseUserDto.country,
        aboutUs: createEnterpriseUserDto.aboutUs,
        countryCode: createEnterpriseUserDto.countryCode || null,
        status: 'pending',
      });

      // Send email to pipaliyayakshat@gmail.com with registration details
      this.mailService.sendEnterpriseRegistrationEmail({
        firstName: createEnterpriseUserDto.firstName,
        lastName: createEnterpriseUserDto.lastName,
        email: createEnterpriseUserDto.email,
        contactNumber: createEnterpriseUserDto.contactNumber,
        organizationName: createEnterpriseUserDto.organizationName,
        city: createEnterpriseUserDto.city,
        country: createEnterpriseUserDto.country,
        aboutUs: createEnterpriseUserDto.aboutUs,
        countryCode: createEnterpriseUserDto.countryCode,
      });

      return {
        statusCode: HttpStatus.CREATED,
        message: 'Enterprise user registration request submitted successfully!',
        data: { registrationId: contentFileData._id },
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  private sanitizeUser(user: UserDocument) {
    const {
      forgotPassword,
      password,
      otp,
      otpSendDate,
      verifyOtp,
      __v,
      ...safeData
    } = user.toObject();
    return safeData;
  }
}
