import {
  Injectable,
  BadRequestException,
  HttpException,
  HttpStatus,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId, Types } from 'mongoose';
import { Organization, OrganizationDocument } from './entities/orgenaztion.entity';
import { User, UserDocument } from '../users/entities/user.entity';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { getUploadBasePath, getPublicUrlPath } from '../common/multer.service';
import * as nodemailer from 'nodemailer';
import { AdminCreation } from './entities/admin-creation.entity';
import { SubscriptionPlan, SubscriptionPlanDocument } from '../subscription/entities/subscription-plan.entity';
import { TeamMember } from './entities/team-member.entity';
import { Team, TeamDocument } from './entities/team.entity';
import { InternalServerErrorException } from '@nestjs/common';
import { Deck, DeckDocument } from '../content/schemas/deck.schema';
import { TeamGameScore, TeamGameScoreDocument } from './entities/team-game.entity';
import { GameProgress, GameProgressDocument } from '../content/schemas/game-progress.schema';
import { Topic, TopicDocument } from '../content/schemas/topic.schema';
import { SubTopic, SubTopicDocument } from '../content/schemas/subtopic.schema';
import { TopicProgress, TopicProgressDocument } from '../content/schemas/topic-progress.schema';
import { Game, GameDocument } from '../content/schemas/game.schema';

@Injectable()
export class TeamService {
  private transporter;
  private readonly freeEmailDomains = [
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com',
    'rediffmail.com', 'icloud.com', 'zoho.com', 'mail.com', 'aol.com',
    'gmx.com', 'protonmail.com', 'proton.me', 'yandex.com', 'tutanota.com',
    'fastmail.com', 'example.com',
  ];
  constructor(
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(AdminCreation.name) private adminCreationModel: Model<AdminCreation>,
    @InjectModel(SubscriptionPlan.name)
    private readonly subscriptionPlanModel: Model<SubscriptionPlanDocument>,
    @InjectModel(TeamMember.name) private teamMemberModel: Model<TeamMember>,
    @InjectModel(Team.name) private teamModel: Model<TeamDocument>,
    @InjectModel(Deck.name) private deckModel: Model<DeckDocument>,
    @InjectModel(TeamGameScore.name) private teamGameScoreModel: Model<TeamGameScoreDocument>,
    @InjectModel(GameProgress.name) private gameProgressModel: Model<GameProgressDocument>,
    @InjectModel(Topic.name) private topicModel: Model<TopicDocument>,
    @InjectModel(SubTopic.name) private subTopicModel: Model<SubTopicDocument>,
    @InjectModel(TopicProgress.name) private topicProgressModel: Model<TopicProgressDocument>,
    @InjectModel(Game.name) private gameModel: Model<GameDocument>,
  ) {
    {
      this.transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        auth: {
          user: "pipaliyayakshat@gmail.com",
          pass: 'ytjx exfu jnny ouyp',
        },
      });
    }
  }

  private normalizeId<T = any>(value: T): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    return value && typeof value === 'object' && 'toString' in value
      ? (value as any).toString()
      : String(value);
  }

  /**
   * Validate if email is a business email (not a free email domain)
   */
  private validateBusinessEmail(email: string): void {
    if (!email || typeof email !== 'string') {
      throw new BadRequestException('Invalid email address');
    }

    const emailParts = email.trim().toLowerCase().split('@');
    if (emailParts.length !== 2) {
      throw new BadRequestException('Invalid email format');
    }

    const domain = emailParts[1];
    if (this.freeEmailDomains.includes(domain)) {
      throw new BadRequestException('Only business emails are valid. Free email domains are not allowed.');
    }
  }

  /**
   * Check if user is NOT Individual type - only non-Individual users can access team service APIs
   */
  private async assertNonIndividualUser(userId: string): Promise<void> {
    const normalizedUserId = this.normalizeId(userId);
    if (!normalizedUserId) {
      throw new BadRequestException('Invalid user ID');
    }

    const user = await this.userModel.findById(normalizedUserId).lean().exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.userType === 'Individual') {
      throw new ForbiddenException('Individual users cannot access team service. Use content service instead.');
    }
  }

  async getAllowedTeamPlans(): Promise<string[]> {
    const allowedPlans = await this.subscriptionPlanModel
      .find({ 
        name: { $in: ['Team', 'Enterprise'] },
        isDeleted: false 
      })
      .select('name')
      .exec();
    
    return allowedPlans.map(plan => plan.name);
  }

  async createOrganization(
    createOrganizationDto: CreateOrganizationDto,
    organizationLogo: Express.Multer.File,
    userId: string,
  ) {
    try {
      // await this.assertNonIndividualUser(userId);
      
      if (!organizationLogo) {
        throw new BadRequestException('Organization logo file is required');
      }

      // Check if user exists and has superAdmin role
      const user = await this.userModel.findById(userId);
      
      if (!user) {
        throw new BadRequestException('User not found');
      }

      if (user.userType !== 'superAdmin') {
        throw new ForbiddenException(
          'Only users with superAdmin type can create organizations',
        );
      }


      // Check if subscription is active
      const hasActivePlan =
        !!user.expirePlanDate &&
        user.expirePlanDate.getTime() > Date.now();

      if (!hasActivePlan) {
        throw new ForbiddenException('Your subscription plan has expired. Please renew your Team subscription plan first.');
      }


      // Prevent a single superAdmin from creating multiple organizations
      const existingOrganizationForUser = await this.organizationModel.findOne({ creatorId: userId }).lean().exec();
      if (existingOrganizationForUser) {
        throw new BadRequestException('A superAdmin can create only one organization');
      }

      // Generate public URL path for nginx
      const logoUrl = getPublicUrlPath('organization-logos', organizationLogo.filename);

      // Create the organization
      const newOrganization = new this.organizationModel({
        name: createOrganizationDto.organizationName,
        logo: logoUrl,
        creatorId: userId,
      });

      const savedOrganization = await newOrganization.save();

      return {
        statusCode: HttpStatus.CREATED,
        message: 'Organization created successfully',
        data: savedOrganization,
      };
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof BadRequestException) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to create organization',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getOrganization(userId: string) {
    try {
      // await this.assertNonIndividualUser(userId);
      
      // Check if user exists and has superAdmin role
      const user = await this.userModel.findById(userId);
      
      if (!user) {
        throw new BadRequestException('User not found');
      }

      if (user.userType !== 'superAdmin') {
        throw new ForbiddenException(
          'Only users with superAdmin type can view their created organizations',
        );
      }

      // Get all organizations created by this user
      const organizations = await this.organizationModel
        .find({ creatorId: userId })
        .exec();

      return {
        statusCode: HttpStatus.OK,
        message: 'Organizations retrieved successfully',
        data: organizations,
      };
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof BadRequestException) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to retrieve organizations',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getAllOrganization(userId: string) {
    try {
      // await this.assertNonIndividualUser(userId);
      
      // Check if user exists and has owner role
      const user = await this.userModel.findById(userId);
      
      if (!user) {
        throw new BadRequestException('User not found');
      }

      if (user.role !== 'admin') {
        throw new ForbiddenException(
          'Only users with admin role can view all organizations',
        );
      }

      // Get all organizations
      const organizations = await this.organizationModel.find().exec();

      return {
        statusCode: HttpStatus.OK,
        message: 'All organizations retrieved successfully',
        data: organizations,
      };
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof BadRequestException) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to retrieve organizations',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async updateOrganization(
    organizationId: string,
    updateOrganizationDto: UpdateOrganizationDto,
    organizationLogo: Express.Multer.File | undefined,
    userId: string,
  ) {
    try {
      // await this.assertNonIndividualUser(userId);
      
      if (!isValidObjectId(organizationId)) {
        throw new BadRequestException('Invalid organization ID');
      }

      // Check if organization exists
      const organization = await this.organizationModel.findById(organizationId);
      
      if (!organization) {
        throw new NotFoundException('Organization not found');
      }

      // Check if user is the creator
      if (organization.creatorId.toString() !== userId) {
        throw new ForbiddenException(
          'Only the creator can update this organization',
        );
      }

      // Update organization name if provided
      if (updateOrganizationDto.organizationName) {
        organization.name = updateOrganizationDto.organizationName;
      }

      // Update logo if file is provided
      if (organizationLogo) {
        organization.logo = getPublicUrlPath('organization-logos', organizationLogo.filename);
      }

      const updatedOrganization = await organization.save();

      return {
        statusCode: HttpStatus.OK,
        message: 'Organization updated successfully',
        data: updatedOrganization,
      };
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to update organization',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async deleteOrganization(organizationId: string, userId: string) {
    try {
      // await this.assertNonIndividualUser(userId);
      
      if (!isValidObjectId(organizationId)) {
        throw new BadRequestException('Invalid organization ID');
      }

      // Check if organization exists
      const organization = await this.organizationModel.findById(organizationId);
      
      if (!organization) {
        throw new NotFoundException('Organization not found');
      }

      // Check if user is the creator
      if (organization.creatorId.toString() !== userId) {
        throw new ForbiddenException(
          'Only the creator can delete this organization',
        );
      }

      // Delete the organization
      await this.organizationModel.findByIdAndDelete(organizationId);

      return {
        statusCode: HttpStatus.OK,
        message: 'Organization deleted successfully',
      };
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to delete organization',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async makeUserAdmin(adminCreatorId: string, organizationId: string | undefined, email: string, name?: string) {
    try {
      // await this.assertNonIndividualUser(adminCreatorId);
      
      // Validate business email (only business emails are allowed, not free email domains)
      this.validateBusinessEmail(email);
      
      // Validate creator first
      if (!isValidObjectId(adminCreatorId)) {
        throw new BadRequestException('Invalid admin creator ID');
      }

      const adminCreator = await this.userModel.findById(adminCreatorId);
      if (!adminCreator) {
        throw new NotFoundException('Admin creator not found');
      }

      // If organizationId is not provided, derive it from adminCreator
      let effectiveOrganizationId = organizationId;
      
      if (!effectiveOrganizationId) {
        if (adminCreator.userType === 'admin') {
          // If adminCreator is an admin, get organization from their organization field
          if (!adminCreator.organization) {
            throw new BadRequestException('Admin user does not have an organization. Organization ID is required.');
          }
          effectiveOrganizationId = adminCreator.organization.toString();
        } else if (adminCreator.userType === 'superAdmin') {
          // If adminCreator is superAdmin, get their first created organization
          const createdOrganization = await this.organizationModel.findOne({ creatorId: adminCreatorId });
          if (!createdOrganization) {
            throw new BadRequestException('SuperAdmin has not created any organization. Organization ID is required.');
          }
          effectiveOrganizationId = createdOrganization._id.toString();
        } else {
          throw new BadRequestException('Organization ID is required for this user type.');
        }
      }

      // Validate organization ID
      if (!isValidObjectId(effectiveOrganizationId)) {
        throw new BadRequestException('Invalid organization ID');
      }

      // Validate organization
      const organization = await this.organizationModel.findById(effectiveOrganizationId);
      if (!organization) {
        throw new NotFoundException('Organization not found');
      }

      // Determine which user's subscription to check
      // If adminCreator is an admin, check the organization creator's subscription
      // If adminCreator is superAdmin, check their own subscription
      let subscriptionOwner = adminCreator;
      if (adminCreator.userType === 'admin') {
        // For admins, check the organization creator's (superAdmin) subscription
        const organizationCreator = await this.userModel.findById(organization.creatorId);
        if (!organizationCreator) {
          throw new NotFoundException('Organization creator not found');
        }
        subscriptionOwner = organizationCreator;
      }
      
      // Determine subscription status
      const hasActivePlan =
        !!subscriptionOwner.expirePlanDate &&
        subscriptionOwner.expirePlanDate.getTime() > Date.now();

      // Fetch plan details only when a plan is present
      let subscriptionPlan: SubscriptionPlanDocument | null = null;
      if (subscriptionOwner.purchasePlanId) {
        subscriptionPlan = await this.subscriptionPlanModel.findById(subscriptionOwner.purchasePlanId);
        if (subscriptionPlan?.isDeleted) {
          subscriptionPlan = null;
        }
      }

      // Normalize teamPlan string for fallback checks
      const userTeamPlan = (subscriptionOwner as any).teamPlan
        ? String((subscriptionOwner as any).teamPlan).toLowerCase()
        : null;

      // Treat explicit teamPlan=enterprise as enterprise access even if no active subscription dates are present.
      const planName = subscriptionPlan?.name?.toLowerCase();
      const isEnterprisePlan =
        planName === 'enterprise' ||
        userTeamPlan === 'enterprise' ||
        (hasActivePlan && planName === 'enterprise') ||
        (hasActivePlan && userTeamPlan === 'enterprise');
      const enforceAdminLimit = !isEnterprisePlan;

      // If an active plan exists and is not Team/Enterprise and userTeamPlan is not enterprise, block
      const allowedPlanNames = ['team', 'enterprise'];
      if (
        subscriptionPlan &&
        hasActivePlan &&
        !allowedPlanNames.includes(planName || '') &&
        userTeamPlan !== 'enterprise'
      ) {
        throw new ForbiddenException('Only Team or Enterprise plans can invite admins.');
      }

      // Check authorization: must be superAdmin or admin of the same organization
      if (
        adminCreator.userType !== 'superAdmin' &&
        !(adminCreator.userType === 'admin' && adminCreator.organization?.toString() === effectiveOrganizationId)
      ) {
        throw new ForbiddenException('Not authorized to add admin to this organization');
      }

      // Check if user already exists
      const existingUser = await this.userModel.findOne({ email });
      if (existingUser) {
        // If user exists, check if they're already an admin for this organization
        if (existingUser.userType === 'admin' && existingUser.organization?.toString() === effectiveOrganizationId) {
          throw new BadRequestException('User is already an admin for this organization');
        }
        // If user exists but is not an admin for this org, we can still invite them
        // (they might be a regular user or admin of another org)
      }

      // Check for existing pending invitation for this email and organization
      const existingInvitation = await this.adminCreationModel.findOne({
        email: email,
        organization: effectiveOrganizationId,
        status: 'pending'
      });

      if (existingInvitation) {
        throw new BadRequestException('A pending invitation already exists for this email and organization');
      }

      // If adminCreator is superAdmin, check pending invitation limit (max 3)
      if (enforceAdminLimit && adminCreator.userType === 'superAdmin') {
        const pendingInvitationCount = await this.adminCreationModel.countDocuments({
          creator: adminCreatorId,
          organization: effectiveOrganizationId,
          status: 'pending'
        });

        if (pendingInvitationCount >= 3) {
          throw new BadRequestException('Maximum of 3 pending admin invitations reached. You cannot send more invitations until some are accepted or cancelled.');
        }
      }

      // Count actual admin users for this organization (users with role='admin' and matching organization)
      if (enforceAdminLimit) {
        const actualAdminCount = await this.userModel.countDocuments({ 
          userType: 'admin',
          organization: effectiveOrganizationId
        });

        if (actualAdminCount >= 3) {
          throw new BadRequestException('Maximum of 3 admin users reached for this organization');
        }
      }

      // Create pending admin invitation
      const adminInvitation = await this.adminCreationModel.create({
        creator: adminCreator._id,
        email: email,
        name: name || undefined,
        organization: effectiveOrganizationId,
        status: 'pending'
      });

      // Send email with verification link
      const invitationMessage = name 
        ? `Hello ${name}, you've been invited to register as admin by ${adminCreator.email} for organization ${organization.name}`
        : `You've been invited to register as admin by ${adminCreator.email} for organization ${organization.name}`;
      
      this.sendAdminInvite(email, {
        // verificationUrl: `http://192.168.29.65:1212/api#/Auth%20Controller/AuthController_adminRegister`,
        verificationUrl: `http://localhost:3000/teams/signup`,
        message: invitationMessage,
      });

      return {
        statusCode: HttpStatus.OK,
        message: 'Admin invitation sent successfully',
        data: {
          invitation: adminInvitation,
          invitedUser: {
            email: email,
            name: name || null
          },
          adminCreator: {
            id: adminCreator._id.toString(),
            email: adminCreator.email,
            name: adminCreator.name
          }
        },
      };
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to send admin invitation',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async sendMail(to: string, subject: string, htmlContent: string) {
    try {
      const info = await this.transporter.sendMail({
        from: `"Your App Name" <pipaliyayakshat@gmail.com>`,
        to,
        subject,
        html: htmlContent,
      });

      // console.log(`✅ Email sent to ${to}, Message ID: ${info.messageId}`);
    } catch (error) {
      console.error(`❌ Failed to send email to ${to}:`, error.message || error);
      throw new Error('Failed to send email');
    }
  }

  async sendAdminInvite(email: string, data: { verificationUrl: string; message?: string }) {
    const subject = 'You have been invited to join as an Admin';
    const html = `
      <!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light only">
    <title>Admin Invitation</title>
    <link rel="shortcut icon" href="https://skillzapai.com/static/media/logo.d8bb8a164e155fcfa2ae.png" type="image/x-icon">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap');

        @media only screen and (max-width: 600px) {
            .main-content>td {
                padding: 40px 15px !important;
            }
            .feature-card {
                width: 100% !important;
                display: block !important;
                padding: 0 0 16px 0 !important;
            }
            .feature-card td {
                text-align: center !important;
                padding: 20px 15px !important;
            }
            .feature-card h4 {
                font-size: 18px !important;
            }
            .feature-card p {
                font-size: 14px !important;
            }
        }
    </style>
</head>

<body style="margin: 0; padding: 0; font-family: Poppins, sans-serif; border: none;">

    <!-- Main Container -->
    <table width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
            <td align="center" style="padding: 20px 0;">

                <!-- Email Container -->
                <table width="100%" border="0" cellspacing="0" cellpadding="0"
                    style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); max-width: 600px;">

                    <!-- Header Section -->
                    <tr>
                        <td
                            style="background-color: #F6F5F8; border-bottom: 1px solid #e9ecef; padding: 30px 16px; border-radius: 12px 12px 0 0;">
                            <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                <tr>
                                    <td style="text-align: center; padding-bottom: 0px;">
                                        <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
                                            <tr>
                                                <td style="text-align: center; padding-bottom: 0px;">
                                                    <table cellpadding="0" cellspacing="0" border="0"
                                                        style="margin: 0 auto;">
                                                        <tr>
                                                            <td style="padding-right: 0px; vertical-align: middle;">
                                                                <img src="https://skillzap.s3.eu-north-1.amazonaws.com/logo+(2).png"
                                                                    alt="Logo" class="mobile-logo"
                                                                    style="max-width: 70px; width: 100%;">
                                                            </td>
                                                            <td style="vertical-align: middle; text-align: left;">
                                                                <div class="mobile-logo-text"
                                                                    style="font-size: 34px; font-weight: 700; color: #010030 !important; display: inline-block !important; line-height: 1.2; margin: 0; letter-spacing: -0.5px;">
                                                                    SkillZap AI</div>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                    <p
                                                        style="margin: 0; color: #000; font-size: 18px; margin-top: 10px;">
                                                        Your Smart Learning Companion</p>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Main Content -->
                    <tr class="main-content">
                        <td style="padding: 40px 25px;">

                            <!-- Invitation Title -->
                            <h2
                                style="margin: 0 0 20px 0; font-size: 24px; font-weight: 700; color: #000 !important; line-height: 1.3;">
                                You're Invited to Join as an Admin!</h2>

                            <!-- Greeting -->
                            <p
                                style="margin: 0 0 20px 0; font-size: 18px; color: #333333 !important;">
                                Hi there! 👋</p>

                            <!-- Main Message -->
                            <p
                                style="margin: 0 0 30px 0; font-size: 16px; color: #333333 !important; line-height: 1.6;">
                                ${data.message || 'You\'ve been invited to register as an admin.'}
                            </p>

                            <!-- Call to Action Button -->
                            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
                                <tr>
                                    <td align="center">
                                        <a href="${data.verificationUrl}"
                                            style="display: inline-block; padding: 16px 32px; background: #4CAF50; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: 600;">
                                            Complete Registration
                                        </a>
                                    </td>
                                </tr>
                            </table>

                            <!-- Alternate Link -->
                            <p style="font-size: 14px; color: #333;">
                                If the button doesn't work, copy this link: 
                                <a href="${data.verificationUrl}" 
                                   style="color: #4CAF50;">${data.verificationUrl}</a>
                            </p>

                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td
                            style="background-color: #f8f9fa; padding: 30px; border-radius: 0 0 12px 12px; text-align: center;">
                            <p style="margin: 0 0 10px 0; font-size: 14px; color: #718096;">
                                © 2025 SkillZap AI. All rights reserved.
                            </p>
                            <p style="margin: 0; font-size: 14px; color: #a0aec0;">
                                If you didn't expect this invitation, you can safely ignore this email.
                            </p>
                        </td>
                    </tr>

                </table>
                <!-- End Email Container -->

            </td>
        </tr>
    </table>
    <!-- End Main Container -->

</body>

</html>
    `;

    this.sendMail(email, subject, html);
  }

  /**
   * Sync memberCount in Team model based on actual TeamMember records
   * Creator is NOT stored in TeamMember, so we count all TeamMember records
   * Handles both approved members (with user) and pending invitations (with email only)
   */
  private async syncTeamMemberCount(teamId: string): Promise<number> {
    try {
      // Count all TeamMember records (creator is not in TeamMember collection)
      const actualCount = await this.teamMemberModel.countDocuments({ team: teamId });
      await this.teamModel.findByIdAndUpdate(teamId, { memberCount: actualCount });
      return actualCount;
    } catch (error) {
      console.error('Error syncing team member count:', error);
      return 0;
    }
  }

  // /**
  //  * Dashboard helper: return organizations, teams, and team members for the authenticated user.
  //  * Uses the user's organization, organizations they created, and any teams they belong to.
  //  */
  async getTeamMembers(teamId: string) {
    try {
      const members = await this.teamMemberModel
        .find({ team: teamId })
        .populate('user', 'name email')
        .exec();

      return members.map((member: any) => {
        if (member.user && typeof member.user === 'object' && 'name' in member.user) {
          return {
            id: member._id,
            userId: member.user._id,
            name: member.user.name,
            email: member.user.email,
            isAdmin: member.isAdmin,
            status: member.status,
            joinedAt: member.joinedAt,
          };
        } else {
          return {
            id: member._id,
            email: member.email,
            isAdmin: member.isAdmin,
            status: member.status,
            joinedAt: member.joinedAt,
          };
        }
      });
    } catch (error) {
      console.error('Error fetching team members:', error);
      return [];
    }
  }


  async createTeamAndAddMember(
    creatorId: string,
    organizationId: string | undefined,
    teamName: string,
    memberEmails?: string[]
  ) {
    try {
      // await this.assertNonIndividualUser(creatorId);
      
      // Step 1: Validate Creator first
      if (!isValidObjectId(creatorId)) {
        throw new BadRequestException('Invalid creator ID');
      }

      const creator = await this.userModel.findById(creatorId);
      if (!creator) {
        throw new NotFoundException('Creator not found');
      }

      // Step 2: If organizationId is not provided, derive it from creator
      let effectiveOrganizationId = organizationId;
      
      if (!effectiveOrganizationId) {
        if (creator.userType === 'admin') {
          // If creator is an admin, get organization from their organization field
          if (!creator.organization) {
            throw new BadRequestException('Admin user does not have an organization. Organization ID is required.');
          }
          effectiveOrganizationId = creator.organization.toString();
        } else if (creator.userType === 'superAdmin') {
          // If creator is superAdmin, get their first created organization
          const createdOrganization = await this.organizationModel.findOne({ creatorId: creatorId });
          if (!createdOrganization) {
            throw new BadRequestException('SuperAdmin has not created any organization. Organization ID is required.');
          }
          effectiveOrganizationId = createdOrganization._id.toString();
        } else {
          throw new ForbiddenException('Only superAdmin or admin users can create teams.');
        }
      }

      // Validate organization ID
      if (!isValidObjectId(effectiveOrganizationId)) {
        throw new BadRequestException('Invalid organization ID');
      }

      // Step 3: Validate Organization
      const organization = await this.organizationModel.findById(effectiveOrganizationId);
      if (!organization) {
        throw new NotFoundException('Organization not found');
      }

      // Step 4: Validate Creator is superAdmin or admin of this org
      const isSuperAdmin = creator.userType === 'superAdmin';
      const isAdminOfOrg = creator.userType === 'admin' && 
        creator.organization && 
        creator.organization.toString() === effectiveOrganizationId;

      if (!isSuperAdmin && !isAdminOfOrg) {
        throw new ForbiddenException('Not authorized to create team in this organization. Only superAdmin or admin of this organization can create teams.');
      }

      // Step 5: Check subscription plan
      // If creator is an admin, check the organization creator's subscription
      // If creator is superAdmin, check their own subscription
      let subscriptionOwner = creator;
      if (creator.userType === 'admin') {
        // For admins, check the organization creator's (superAdmin) subscription
        const organizationCreator = await this.userModel.findById(organization.creatorId);
        if (!organizationCreator) {
          throw new NotFoundException('Organization creator not found');
        }
        subscriptionOwner = organizationCreator;
      }

      const allowedPlans = await this.getAllowedTeamPlans();
      if (!subscriptionOwner.purchasePlanId) {
        throw new ForbiddenException('You need an active Team or Enterprise subscription to create teams.');
      }

      const hasActivePlan =
        subscriptionOwner.expirePlanDate &&
        subscriptionOwner.expirePlanDate.getTime() > Date.now();

      if (!hasActivePlan) {
        throw new ForbiddenException('Your subscription plan has expired. Please renew your Team or Enterprise subscription.');
      }

      const subscriptionPlan = await this.subscriptionPlanModel.findById(subscriptionOwner.purchasePlanId);
      if (!subscriptionPlan || subscriptionPlan.isDeleted) {
        throw new NotFoundException('Subscription plan not found or has been deleted.');
      }

      const planName = subscriptionPlan.name?.toLowerCase?.() || '';
      const userTeamPlan = (subscriptionOwner as any).teamPlan
        ? String((subscriptionOwner as any).teamPlan).toLowerCase()
        : null;
      const isEnterprisePlan = planName === 'enterprise' || userTeamPlan === 'enterprise';

      if (!allowedPlans.includes(subscriptionPlan.name)) {
        throw new ForbiddenException('Only users with Team or Enterprise subscription plans can create teams.');
      }

      // Step 6: Team limit per organization (3 teams max per organization)
      if (!isEnterprisePlan) {
        const teamCount = await this.teamModel.countDocuments({ 
          organization: effectiveOrganizationId 
        });
        if (teamCount >= 3) {
          throw new BadRequestException('Maximum team creation limit (3) for this organization reached');
        }
      }

      // Step 7: Create Team
      const team = await this.teamModel.create({
        teamName,
        creator: creatorId,
        organization: effectiveOrganizationId,
        isActive: true,
        memberCount: 0  // Start at 0, only added members count (creator is NOT a team member)
      });

      // Step 5: Creator is NOT added as TeamMember - only stored in Team.creator field
      // Step 6: Optionally add multiple members by email
      const memberResults: any[] = [];
      if (memberEmails && Array.isArray(memberEmails) && memberEmails.length > 0) {
        // Validate all emails are business emails (not free email domains)
        for (const email of memberEmails) {
          if (email && email !== creator.email) {
            this.validateBusinessEmail(email);
          }
        }

        // Validate: Maximum 10 members per request unless enterprise
        if (!isEnterprisePlan && memberEmails.length > 10) {
          throw new BadRequestException('Maximum of 10 members can be invited in a single request. Please split the invitations into multiple requests.');
        }

        // Filter out creator's email and duplicates
        const uniqueEmails = [...new Set(memberEmails)].filter(
          email => email && email !== creator.email
        );

        const maxMembers = isEnterprisePlan ? Number.POSITIVE_INFINITY : 10;

        // Check current member count before adding (creator is not in TeamMember)
        const currentMemberCount = await this.teamMemberModel.countDocuments({ team: team._id });
        if (currentMemberCount >= maxMembers) {
          throw new BadRequestException(isEnterprisePlan
            ? 'Unable to add members at this time.'
            : 'Maximum team member limit (10) reached. Cannot add more members.');
        }

        // Calculate how many members can still be added
        const remainingSlots = maxMembers - currentMemberCount;
        const emailsToProcess = isEnterprisePlan
          ? uniqueEmails
          : uniqueEmails.slice(0, remainingSlots);
        
        if (!isEnterprisePlan && uniqueEmails.length > remainingSlots) {
          // Add warning for emails that won't be processed
          const skippedEmails = uniqueEmails.slice(remainingSlots);
            skippedEmails.forEach(email => {
            memberResults.push({
              email: email,
              message: 'Maximum team member limit (10) reached. This member was not added.',
              status: 'failed'
            });
          });
        }

        // Add members one by one using the helper method
        for (const memberEmail of emailsToProcess) {
          try {
            const singleResult = await this.addSingleMemberToTeam(
              team._id.toString(),
              creator,
              memberEmail,
              effectiveOrganizationId,
              team,
              organization,
              isEnterprisePlan
            );
            memberResults.push(singleResult);
          } catch (err) {
            memberResults.push({
              email: memberEmail,
              message: err.message || 'Failed to add member',
              status: 'failed'
            });
          }
        }
      }

      // Step 8: Sync memberCount (count only non-creator members) and fetch updated team with members
      const actualMemberCount = await this.syncTeamMemberCount(team._id.toString());
      const updatedTeam = await this.teamModel.findById(team._id);
      const members = await this.getTeamMembers(team._id.toString());

      return {
        statusCode: HttpStatus.CREATED,
        message: 'Team created successfully',
        data: {
          team: {
            id: team._id,
            name: team.teamName,
            creator: {
              id: creator._id,
              email: creator.email,
              name: creator.name
            },
            organization: effectiveOrganizationId,
            memberCount: updatedTeam?.memberCount || actualMemberCount,
            members: members
          },
          memberResults: memberResults.length > 0 ? memberResults : undefined
        }
      };
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to create team',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private async addSingleMemberToTeam(
    teamId: string,
    adminUser: any,
    memberEmail: string,
    organizationId: string,
    team: any,
    organization: any,
    allowUnlimitedMembers = false
  ) {
    // Prevent re-adding the admin/creator
    if (memberEmail === adminUser.email) {
      return {
        email: memberEmail,
        message: 'Admin already part of the team',
        status: 'skipped',
      };
    }

    // Validate business email (only business emails are allowed, not free email domains)
    this.validateBusinessEmail(memberEmail);

    // Check member count limit (max 10 members, creator is not in TeamMember) unless enterprise
    const maxMembers = allowUnlimitedMembers ? Number.POSITIVE_INFINITY : 10;
    const actualMemberCount = await this.teamMemberModel.countDocuments({ team: teamId });
    if (actualMemberCount >= maxMembers) {
      return {
        email: memberEmail,
        message: allowUnlimitedMembers ? 'Unable to add member at this time.' : 'Maximum team member limit (10) reached',
        status: 'failed',
      };
    }

    // Check if user exists in the system
    const existingUser = await this.userModel.findOne({ email: memberEmail });

    if (existingUser) {
      // Check if user is already an admin in this organization
      const isAdminInOrg = await this.adminCreationModel.findOne({
        createdAdmin: existingUser._id,
        organization: organizationId,
        status: 'approved'
      });

      if (isAdminInOrg) {
        return {
          email: memberEmail,
          message: 'User is already an admin in this organization and cannot be added as a team member',
          status: 'skipped',
        };
      }

      // Check if already in ANY team (across all organizations) - one member can only be in one team
      const isAlreadyMember = await this.teamMemberModel.findOne({ 
        user: existingUser._id
      });
      if (isAlreadyMember) {
        // Get the team name and organization for better error message
        const existingTeamMember = await this.teamMemberModel.findOne({ 
          user: existingUser._id
        }).populate('team', 'teamName').populate('organization', 'name');
        
        const existingTeamName = existingTeamMember?.team && typeof existingTeamMember.team === 'object' && 'teamName' in existingTeamMember.team
          ? existingTeamMember.team.teamName
          : 'another team';
        
        const existingOrgName = existingTeamMember?.organization && typeof existingTeamMember.organization === 'object' && 'name' in existingTeamMember.organization
          ? existingTeamMember.organization.name
          : 'another organization';
        
        throw new BadRequestException(
          `User ${memberEmail} is already a member of team "${existingTeamName}" in organization "${existingOrgName}". A member can only be in one team across all organizations.`
        );
      }

      // Check if already a member of this specific team
      const isMemberOfThisTeam = await this.teamMemberModel.findOne({
        team: teamId,
        user: existingUser._id
      });
      if (isMemberOfThisTeam) {
        throw new BadRequestException('User is already a member of this team');
      }

      // Add user as approved member
      await this.teamMemberModel.create({
        team: teamId,
        organization: organizationId,
        user: existingUser._id,
        isAdmin: false,
        status: 'approved',
        creator: adminUser._id
      });

      // Increment memberCount (only non-creator members are counted)
      await this.teamModel.findByIdAndUpdate(teamId, { $inc: { memberCount: 1 } });

      return {
        email: memberEmail,
        message: 'Member added successfully',
        status: 'approved',
        user: {
          id: existingUser._id,
          email: existingUser.email,
          name: existingUser.name
        }
      };
    } else {
      // Check if invitation already exists for this team
      const existingInvitation = await this.teamMemberModel.findOne({
        team: teamId,
        email: memberEmail,
        status: 'pending'
      });

      if (existingInvitation) {
        throw new BadRequestException('An invitation has already been sent to this email for this team');
      }

      // Check if this email has a pending or approved invitation in ANY team (across all organizations) - one member can only be in one team
      const existingMemberInAnyTeam = await this.teamMemberModel.findOne({
        email: memberEmail
      });

      if (existingMemberInAnyTeam) {
        // Get the team name and organization for better error message
        const existingTeamMember = await this.teamMemberModel.findOne({
          email: memberEmail
        }).populate('team', 'teamName').populate('organization', 'name');
        
        const existingTeamName = existingTeamMember?.team && typeof existingTeamMember.team === 'object' && 'teamName' in existingTeamMember.team
          ? existingTeamMember.team.teamName
          : 'another team';
        
        const existingOrgName = existingTeamMember?.organization && typeof existingTeamMember.organization === 'object' && 'name' in existingTeamMember.organization
          ? existingTeamMember.organization.name
          : 'another organization';
        
        const statusMessage = existingMemberInAnyTeam.status === 'pending' 
          ? 'has a pending invitation' 
          : 'is already a member';
        
        throw new BadRequestException(
          `User with email ${memberEmail} ${statusMessage} in team "${existingTeamName}" in organization "${existingOrgName}". A member can only be in one team across all organizations.`
        );
      }

      // Invite user via email (not registered yet)
      await this.teamMemberModel.create({
        team: teamId,
        organization: organizationId,
        email: memberEmail,
        isAdmin: false,
        status: 'pending',
        creator: adminUser._id
      });

      // Increment memberCount (only non-creator members are counted)
      await this.teamModel.findByIdAndUpdate(teamId, { $inc: { memberCount: 1 } });

      // const frontendUrl = 'http://192.168.29.65:1212/api#/Auth%20Controller/AuthController_memberRegister';
      const frontendUrl = 'http://localhost:3000/teams/signup'
      // const html = `
      //   <div style="font-family: Arial, sans-serif; color: #333;">
      //     <h2>Team Invitation</h2>
      //     <p>You have been invited to join the team "<strong>${team.teamName}</strong>" in organization "${organization.name}".</p>
      //     <p>Please click the link below to register and join the team:</p>
      //     <a href="${frontendUrl}?email=${encodeURIComponent(memberEmail)}" 
      //        style="display:inline-block;padding:10px 20px;background:#4CAF50;color:#fff;text-decoration:none;border-radius:5px;" 
      //        target="_blank">
      //       Join Now
      //     </a>
      //     <p>If the button doesn't work, copy this link: ${frontendUrl}/register?email=${encodeURIComponent(memberEmail)}</p>
      //   </div>
      // `;
      const html = `
      <!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light only">
    <title>Team Invitation</title>
    <link rel="shortcut icon" href="https://skillzapai.com/static/media/logo.d8bb8a164e155fcfa2ae.png" type="image/x-icon">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap');

        @media only screen and (max-width: 600px) {
            .main-content>td {
                padding: 40px 15px !important;
            }
            .feature-card {
                width: 100% !important;
                display: block !important;
                padding: 0 0 16px 0 !important;
            }
            .feature-card td {
                text-align: center !important;
                padding: 20px 15px !important;
            }
            .feature-card h4 {
                font-size: 18px !important;
            }
            .feature-card p {
                font-size: 14px !important;
            }
        }
    </style>
</head>

<body style="margin: 0; padding: 0; font-family: Poppins, sans-serif; border: none;">

    <!-- Main Container -->
    <table width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
            <td align="center" style="padding: 20px 0;">

                <!-- Email Container -->
                <table width="100%" border="0" cellspacing="0" cellpadding="0"
                    style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); max-width: 600px;">

                    <!-- Header Section -->
                    <tr>
                        <td
                            style="background-color: #F6F5F8; border-bottom: 1px solid #e9ecef; padding: 30px 16px; border-radius: 12px 12px 0 0;">
                            <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                <tr>
                                    <td style="text-align: center; padding-bottom: 0px;">
                                        <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
                                            <tr>
                                                <td style="text-align: center; padding-bottom: 0px;">
                                                    <table cellpadding="0" cellspacing="0" border="0"
                                                        style="margin: 0 auto;">
                                                        <tr>
                                                            <td style="padding-right: 0px; vertical-align: middle;">
                                                                <img src="https://skillzap.s3.eu-north-1.amazonaws.com/logo+(2).png"
                                                                    alt="Logo" class="mobile-logo"
                                                                    style="max-width: 70px; width: 100%;">
                                                            </td>
                                                            <td style="vertical-align: middle; text-align: left;">
                                                                <div class="mobile-logo-text"
                                                                    style="font-size: 34px; font-weight: 700; color: #010030 !important; display: inline-block !important; line-height: 1.2; margin: 0; letter-spacing: -0.5px;">
                                                                    SkillZap AI</div>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                    <p
                                                        style="margin: 0; color: #000; font-size: 18px; margin-top: 10px;">
                                                        Your Smart Learning Companion</p>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Main Content -->
                    <tr class="main-content">
                        <td style="padding: 40px 25px;">

                            <!-- Invitation Title -->
                            <h2
                                style="margin: 0 0 20px 0; font-size: 24px; font-weight: 700; color: #000 !important; line-height: 1.3;">
                                You're Invited to Join the Team!</h2>

                            <!-- Greeting -->
                            <p
                                style="margin: 0 0 20px 0; font-size: 18px; color: #333333 !important;">
                                Hi there! 👋</p>

                            <!-- Main Message -->


                            <!-- Call to Action Button -->
                            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
                                <tr>
                                    <td align="center">
                                        <a href="http://localhost:3000/teams/signup/"
                                            style="display: inline-block; padding: 16px 32px; background: #4CAF50; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: 600;">
                                            Join Now
                                        </a>
                                    </td>
                                </tr>
                            </table>

                            <!-- Alternate Link -->
                            <p style="font-size: 14px; color: #333;">
                                If the button doesn't work, copy this link: 
                                <a href="http://localhost:3000/teams/signup/" 
                                   style="color: #4CAF50;">http://localhost:3000/teams/signup/</a>
                            </p>

                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td
                            style="background-color: #f8f9fa; padding: 30px; border-radius: 0 0 12px 12px; text-align: center;">
                            <p style="margin: 0 0 10px 0; font-size: 14px; color: #718096;">
                                © 2025 SkillZap AI. All rights reserved.
                            </p>
                            <p style="margin: 0; font-size: 14px; color: #a0aec0;">
                                If you didn't expect this invitation, you can safely ignore this email.
                            </p>
                        </td>
                    </tr>

                </table>
                <!-- End Email Container -->

            </td>
        </tr>
    </table>
    <!-- End Main Container -->

</body>

</html>

`

      try {
         this.sendMail(
          memberEmail,
          'You have been invited to join a team',
          html
        );
      } catch (err) {
        console.error('Email sending failed:', err.message);
        return {
          email: memberEmail,
          message: 'Failed to send invitation email',
          status: 'failed',
        };
      }

      return {
        email: memberEmail,
        message: `Invitation email sent to ${memberEmail}`,
        status: 'pending',
      };
    }
  }

  async addMemberToTeam(
    teamId: string,
    adminUserId: string,
    memberEmails: string[],
    organizationId: string | undefined
  ) {
    try {
      // await this.assertNonIndividualUser(adminUserId);
      
      // Step 0: Validate inputs
      if (!isValidObjectId(teamId)) {
        throw new BadRequestException('Invalid team ID');
      }

      if (!isValidObjectId(adminUserId)) {
        throw new BadRequestException('Invalid admin user ID');
      }

      if (!Array.isArray(memberEmails) || memberEmails.length === 0) {
        throw new BadRequestException('memberEmails must be a non-empty array');
      }

      // Validate all emails are business emails (not free email domains)
      for (const email of memberEmails) {
        if (email) {
          this.validateBusinessEmail(email);
        }
      }

      // Step 1: Validate Team
      const team = await this.teamModel.findById(teamId);
      if (!team) {
        throw new NotFoundException('Team not found');
      }

      // Step 2: Validate Admin User first
      const adminUser = await this.userModel.findById(adminUserId);
      if (!adminUser) {
        throw new NotFoundException('Admin user not found');
      }

      // Step 3: If organizationId is not provided, derive it from adminUser
      let effectiveOrganizationId = organizationId;
      
      if (!effectiveOrganizationId) {
        if (adminUser.userType === 'admin') {
          // If adminUser is an admin, get organization from their organization field
          if (!adminUser.organization) {
            throw new BadRequestException('Admin user does not have an organization. Organization ID is required.');
          }
          effectiveOrganizationId = adminUser.organization.toString();
        } else if (adminUser.userType === 'superAdmin') {
          // If adminUser is superAdmin, get their first created organization
          const createdOrganization = await this.organizationModel.findOne({ creatorId: adminUserId });
          if (!createdOrganization) {
            throw new BadRequestException('SuperAdmin has not created any organization. Organization ID is required.');
          }
          effectiveOrganizationId = createdOrganization._id.toString();
        } else {
          throw new ForbiddenException('Only superAdmin or admin users can add members to teams.');
        }
      }

      // Validate organization ID
      if (!isValidObjectId(effectiveOrganizationId)) {
        throw new BadRequestException('Invalid organization ID');
      }

      // Step 4: Validate Organization
      const organization = await this.organizationModel.findById(effectiveOrganizationId);
      if (!organization) {
        throw new NotFoundException('Organization not found');
      }

      // Step 5: Check authorization - admin must be superAdmin or admin of this org
      const isSuperAdmin = adminUser.userType === 'superAdmin';
      const isAdminOfOrg = adminUser.userType === 'admin' && 
        adminUser.organization && 
        adminUser.organization.toString() === effectiveOrganizationId;

      if (!isSuperAdmin && !isAdminOfOrg) {
        throw new ForbiddenException('Not authorized to add members to this team');
      }

      // Step 4.5: Detect enterprise plan for unlimited members
      let allowUnlimitedMembers = false;
      try {
        let subscriptionOwner = adminUser;
        if (adminUser.userType === 'admin' && organization.creatorId) {
          const organizationCreator = await this.userModel.findById(organization.creatorId);
          if (organizationCreator) {
            subscriptionOwner = organizationCreator;
          }
        }

        const userTeamPlan = (subscriptionOwner as any).teamPlan
          ? String((subscriptionOwner as any).teamPlan).toLowerCase()
          : null;

        let subscriptionPlan: SubscriptionPlanDocument | null = null;
        if ((subscriptionOwner as any).purchasePlanId) {
          subscriptionPlan = await this.subscriptionPlanModel.findById(
            (subscriptionOwner as any).purchasePlanId,
          );
          if (subscriptionPlan?.isDeleted) {
            subscriptionPlan = null;
          }
        }

        const planName = subscriptionPlan?.name?.toLowerCase() || '';
        allowUnlimitedMembers = planName === 'enterprise' || userTeamPlan === 'enterprise';
      } catch (err) {
        allowUnlimitedMembers = false;
      }

      // Validate: Maximum 10 members can be invited in a single API call unless enterprise
      if (!allowUnlimitedMembers && memberEmails.length > 10) {
        throw new BadRequestException('Maximum of 10 members can be invited in a single request. Please split the invitations into multiple requests.');
      }

      // Step 5: Filter out duplicates and admin's email
      const uniqueEmails = [...new Set(memberEmails)].filter(
        email => email && email !== adminUser.email
      );

      if (uniqueEmails.length === 0) {
        throw new BadRequestException('No valid member emails provided (excluding duplicates and admin email)');
      }

      // Step 5.5: Check current member count before processing (creator is not in TeamMember)
      const maxMembers = allowUnlimitedMembers ? Number.POSITIVE_INFINITY : 10;
      const currentMemberCount = await this.teamMemberModel.countDocuments({ team: teamId });
      if (currentMemberCount >= maxMembers) {
        throw new BadRequestException(
          allowUnlimitedMembers
            ? 'Unable to add members at this time.'
            : 'Maximum team member limit (10) reached. Cannot add more members.',
        );
      }

      // Calculate how many members can still be added (max 10 members)
      const remainingSlots = maxMembers - currentMemberCount;
      const emailsToProcess = allowUnlimitedMembers
        ? uniqueEmails
        : uniqueEmails.slice(0, remainingSlots);
      
      // Step 6: Process each member
      const memberResults: any[] = [];
      
      // Add failed status for emails that exceed the limit
      if (!allowUnlimitedMembers && uniqueEmails.length > remainingSlots) {
        const skippedEmails = uniqueEmails.slice(remainingSlots);
        skippedEmails.forEach(email => {
          memberResults.push({
            email: email,
            message: 'Maximum team member limit (10) reached. This member was not added.',
            status: 'failed'
          });
        });
      }

      for (const memberEmail of emailsToProcess) {
        try {
          // Double-check limit before each addition
          if (!allowUnlimitedMembers) {
            const checkCount = await this.teamMemberModel.countDocuments({ team: teamId });
            if (checkCount >= maxMembers) {
              memberResults.push({
                email: memberEmail,
                message: 'Maximum team member limit (10) reached',
                status: 'failed'
              });
              break;
            }
          }

          const result = await this.addSingleMemberToTeam(
            teamId,
            adminUser,
            memberEmail,
            effectiveOrganizationId,
            team,
            organization,
            allowUnlimitedMembers
          );
          memberResults.push(result);
        } catch (error) {
          // Continue with other members even if one fails
          memberResults.push({
            email: memberEmail,
            message: error.message || 'Failed to add member',
            status: 'failed',
          });
        }
      }

      // Step 7: Sync memberCount (count only non-creator members) and fetch updated members list
      const actualMemberCount = await this.syncTeamMemberCount(teamId);
      const members = await this.getTeamMembers(teamId);
      const updatedTeam = await this.teamModel.findById(teamId);

      // Step 8: Count successful additions
      const successCount = memberResults.filter(r => r.status === 'approved' || r.status === 'pending').length;
      const failedCount = memberResults.filter(r => r.status === 'failed').length;
      const skippedCount = memberResults.filter(r => r.status === 'skipped').length;

      return {
        statusCode: HttpStatus.OK,
        message: `Processed ${uniqueEmails.length} member(s). ${successCount} added/invited, ${failedCount} failed, ${skippedCount} skipped.`,
        data: {
          team: {
            id: team._id,
            name: team.teamName,
            memberCount: updatedTeam?.memberCount || actualMemberCount,
          },
          memberResults: memberResults,
          members: members
        }
      };
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to add members to team',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async removeMemberFromTeam(
    teamId: string,
    adminUserId: string,
    memberId: string,
    organizationId: string | undefined
  ) {
    try {
      // await this.assertNonIndividualUser(adminUserId);
      
      // Step 0: Validate inputs
      if (!isValidObjectId(teamId)) {
        throw new BadRequestException('Invalid team ID');
      }

      if (!isValidObjectId(adminUserId)) {
        throw new BadRequestException('Invalid admin user ID');
      }

      if (!isValidObjectId(memberId)) {
        throw new BadRequestException('Invalid member ID');
      }

      // Step 1: Validate Team
      const team = await this.teamModel.findById(teamId);
      if (!team) {
        throw new NotFoundException('Team not found');
      }

      // Step 2: Validate Admin User first
      const adminUser = await this.userModel.findById(adminUserId);
      if (!adminUser) {
        throw new NotFoundException('Admin user not found');
      }

      // Step 3: If organizationId is not provided, derive it from adminUser
      let effectiveOrganizationId = organizationId;
      
      if (!effectiveOrganizationId) {
        if (adminUser.userType === 'admin') {
          // If adminUser is an admin, get organization from their organization field
          if (!adminUser.organization) {
            throw new BadRequestException('Admin user does not have an organization. Organization ID is required.');
          }
          effectiveOrganizationId = adminUser.organization.toString();
        } else if (adminUser.userType === 'superAdmin') {
          // If adminUser is superAdmin, get their first created organization
          const createdOrganization = await this.organizationModel.findOne({ creatorId: adminUserId });
          if (!createdOrganization) {
            throw new BadRequestException('SuperAdmin has not created any organization. Organization ID is required.');
          }
          effectiveOrganizationId = createdOrganization._id.toString();
        } else {
          throw new ForbiddenException('Only superAdmin or admin users can remove members from teams.');
        }
      }

      // Validate organization ID
      if (!isValidObjectId(effectiveOrganizationId)) {
        throw new BadRequestException('Invalid organization ID');
      }

      // Step 4: Validate Organization
      const organization = await this.organizationModel.findById(effectiveOrganizationId);
      if (!organization) {
        throw new NotFoundException('Organization not found');
      }

      // Step 5: Check authorization - admin must be superAdmin or admin of this org
      const isSuperAdmin = adminUser.userType === 'superAdmin';
      const isAdminOfOrg = adminUser.userType === 'admin' && 
        adminUser.organization && 
        adminUser.organization.toString() === effectiveOrganizationId;

      if (!isSuperAdmin && !isAdminOfOrg) {
        throw new ForbiddenException('Not authorized to remove members from this team');
      }

      // Step 6: Validate that team belongs to the organization
      if (team.organization.toString() !== effectiveOrganizationId) {
        throw new BadRequestException('Team does not belong to the specified organization');
      }

      // Step 7: Find the team member
      // First try to find by TeamMember _id, if not found, try to find by user _id
      let teamMember = await this.teamMemberModel.findById(memberId);
      
      // If not found by _id, try to find by user field (in case memberId is actually a userId)
      if (!teamMember) {
        teamMember = await this.teamMemberModel.findOne({
          user: memberId,
          team: teamId
        });
      }
      
      if (!teamMember) {
        throw new NotFoundException('Team member not found. Please provide either TeamMember ID or User ID that belongs to this team.');
      }

      // Step 8: Validate that member belongs to this team
      if (teamMember.team.toString() !== teamId) {
        throw new BadRequestException('Member does not belong to this team');
      }

      // Step 9: Store member info before deletion for response
      const memberUserId = teamMember.user ? teamMember.user.toString() : null;
      const memberEmail = teamMember.email || null;
      const memberStatus = teamMember.status;
      const memberIsAdmin = teamMember.isAdmin;

      // Step 10: If member has a user account (approved member), permanently delete the user
      if (memberUserId) {
        await this.userModel.findByIdAndDelete(memberUserId);
      }

      // Step 11: Permanently delete the team member from TeamMember collection
      // Creator is not in TeamMember collection, so we can safely remove any TeamMember
      await this.teamMemberModel.findByIdAndDelete(teamMember._id);

      // Step 12: Decrement memberCount
      await this.teamModel.findByIdAndUpdate(teamId, { $inc: { memberCount: -1 } });

      // Step 13: Sync memberCount and fetch updated members list
      const actualMemberCount = await this.syncTeamMemberCount(teamId);
      const members = await this.getTeamMembers(teamId);
      const updatedTeam = await this.teamModel.findById(teamId);

      return {
        statusCode: HttpStatus.OK,
        message: 'Member removed from team successfully. Team member and user (if applicable) have been permanently deleted from the database.',
        data: {
          team: {
            id: team._id,
            name: team.teamName,
            memberCount: updatedTeam?.memberCount || actualMemberCount,
          },
          removedMember: {
            id: teamMember._id,
            userId: memberUserId,
            email: memberEmail,
            isAdmin: memberIsAdmin,
            status: memberStatus,
            userDeleted: memberUserId ? true : false,
          },
          members: members
        }
      };
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to remove member from team',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async moveMemberToTeam(
    teamId: string,
    adminUserId: string,
    memberId: string,
    moveTeamId: string
  ) {
    try {
      // await this.assertNonIndividualUser(adminUserId);
      
      // Step 0: Validate inputs
      if (!isValidObjectId(teamId)) {
        throw new BadRequestException('Invalid source team ID');
      }

      if (!isValidObjectId(moveTeamId)) {
        throw new BadRequestException('Invalid destination team ID');
      }

      if (!isValidObjectId(adminUserId)) {
        throw new BadRequestException('Invalid admin user ID');
      }

      if (!isValidObjectId(memberId)) {
        throw new BadRequestException('Invalid member ID');
      }

      // Check if source and destination teams are different
      if (teamId === moveTeamId) {
        throw new BadRequestException('Source team and destination team cannot be the same');
      }

      // Step 1: Validate Admin User first to get organization
      const adminUser = await this.userModel.findById(adminUserId);
      if (!adminUser) {
        throw new NotFoundException('Admin user not found');
      }

      // Step 2: Validate Source Team
      const sourceTeam = await this.teamModel.findById(teamId);
      if (!sourceTeam) {
        throw new NotFoundException('Source team not found');
      }

      // Step 3: Validate Destination Team
      const destinationTeam = await this.teamModel.findById(moveTeamId);
      if (!destinationTeam) {
        throw new NotFoundException('Destination team not found');
      }

      // Step 4: Get organizationId from user or teams
      let organizationId: string;
      const isSuperAdmin = adminUser.userType === 'superAdmin';
      
      if (isSuperAdmin) {
        // For superAdmin, get organization from source team
        organizationId = sourceTeam.organization.toString();
      } else if (adminUser.userType === 'admin' && adminUser.organization) {
        // For admin, get organization from user's organization field
        organizationId = adminUser.organization.toString();
      } else {
        throw new ForbiddenException('User is not authorized to move members between teams');
      }

      // Step 5: Validate Organization
      const organization = await this.organizationModel.findById(organizationId);
      if (!organization) {
        throw new NotFoundException('Organization not found');
      }

      // Step 6: Check authorization - admin must be superAdmin or admin of this org
      if (isSuperAdmin) {
        // For superAdmin, verify they created this organization
        if (organization.creatorId.toString() !== adminUserId) {
          throw new ForbiddenException('You are not authorized to move members in this organization. Only the organization creator can perform this action.');
        }
      } else {
        // For admin, verify they belong to this organization
        const isAdminOfOrg = adminUser.userType === 'admin' && 
          adminUser.organization && 
          adminUser.organization.toString() === organizationId;

        if (!isAdminOfOrg) {
          throw new ForbiddenException('Not authorized to move members between teams in this organization');
        }
      }

      // Step 7: Validate that both teams belong to the organization and are in the same organization
      if (sourceTeam.organization.toString() !== organizationId) {
        throw new BadRequestException('Source team does not belong to your organization');
      }

      if (destinationTeam.organization.toString() !== organizationId) {
        throw new BadRequestException('Destination team does not belong to your organization');
      }

      // Ensure both teams are in the same organization
      if (sourceTeam.organization.toString() !== destinationTeam.organization.toString()) {
        throw new BadRequestException('Source team and destination team must belong to the same organization');
      }

      // Step 8: Find the team member in source team
      let teamMember = await this.teamMemberModel.findById(memberId);
      
      // If not found by _id, try to find by user field (in case memberId is actually a userId)
      if (!teamMember) {
        teamMember = await this.teamMemberModel.findOne({
          user: memberId,
          team: teamId
        });
      }
      
      if (!teamMember) {
        throw new NotFoundException('Team member not found in source team. Please provide either TeamMember ID or User ID that belongs to this team.');
      }

      // Step 9: Validate that member belongs to source team
      if (teamMember.team.toString() !== teamId) {
        throw new BadRequestException('Member does not belong to the source team');
      }

      // Step 9.5: Detect enterprise plan for unlimited member moves
      let allowUnlimitedMembers = false;
      try {
        // Determine subscription owner: if admin, check organization creator's subscription; if superAdmin, check their own
        let subscriptionOwner = adminUser;
        if (adminUser.userType === 'admin' && organization.creatorId) {
          const organizationCreator = await this.userModel.findById(organization.creatorId);
          if (organizationCreator) {
            subscriptionOwner = organizationCreator;
          }
        }

        // Check for enterprise plan via subscriptionPlan or teamPlan field
        const userTeamPlan = (subscriptionOwner as any).teamPlan
          ? String((subscriptionOwner as any).teamPlan).toLowerCase()
          : null;

        let subscriptionPlan: SubscriptionPlanDocument | null = null;
        if (subscriptionOwner.purchasePlanId) {
          subscriptionPlan = await this.subscriptionPlanModel.findById(
            subscriptionOwner.purchasePlanId,
          );
          if (subscriptionPlan?.isDeleted) {
            subscriptionPlan = null;
          }
        }

        const planName = subscriptionPlan?.name?.toLowerCase() || '';
        allowUnlimitedMembers = planName === 'enterprise' || userTeamPlan === 'enterprise';
      } catch (err) {
        // If there's any error checking subscription, default to limited members
        allowUnlimitedMembers = false;
      }

      // Step 10: Check destination team member count (max 10 members unless enterprise plan)
      const destinationMemberCount = await this.teamMemberModel.countDocuments({ team: moveTeamId });
      if (!allowUnlimitedMembers && destinationMemberCount >= 10) {
        throw new BadRequestException('Destination team has reached maximum member limit (10). Cannot move member to this team.');
      }

      // Step 11: Check if member already exists in destination team
      let existingMemberInDestination = null;
      if (teamMember.user) {
        existingMemberInDestination = await this.teamMemberModel.findOne({
          user: teamMember.user,
          team: moveTeamId
        });
      } else if (teamMember.email) {
        existingMemberInDestination = await this.teamMemberModel.findOne({
          email: teamMember.email,
          team: moveTeamId
        });
      }

      if (existingMemberInDestination) {
        throw new BadRequestException('Member already exists in the destination team');
      }

      // Step 12: Store member info before moving
      const memberUserId = teamMember.user ? teamMember.user.toString() : null;
      const memberEmail = teamMember.email || null;
      const memberStatus = teamMember.status;
      const memberIsAdmin = teamMember.isAdmin;
      const memberCreatorId = teamMember.creator ? teamMember.creator.toString() : adminUserId;

      // Step 13: Remove member from source team
      await this.teamMemberModel.findByIdAndDelete(teamMember._id);
      
      // Step 14: Decrement source team member count
      await this.teamModel.findByIdAndUpdate(teamId, { $inc: { memberCount: -1 } });

      // Step 15: Add member to destination team with same properties
      const newTeamMember = await this.teamMemberModel.create({
        team: moveTeamId,
        organization: organizationId,
        user: teamMember.user || null,
        email: teamMember.email || null,
        isAdmin: memberIsAdmin,
        status: memberStatus,
        creator: memberCreatorId,
        joinedAt: new Date() // Reset joinedAt for the new team
      });

      // Step 16: Increment destination team member count
      await this.teamModel.findByIdAndUpdate(moveTeamId, { $inc: { memberCount: 1 } });

      // Step 17: Sync member counts and fetch updated teams
      const sourceMemberCount = await this.syncTeamMemberCount(teamId);
      const destinationMemberCountAfter = await this.syncTeamMemberCount(moveTeamId);
      
      const updatedSourceTeam = await this.teamModel.findById(teamId);
      const updatedDestinationTeam = await this.teamModel.findById(moveTeamId);
      
      const sourceTeamMembers = await this.getTeamMembers(teamId);
      const destinationTeamMembers = await this.getTeamMembers(moveTeamId);

      return {
        statusCode: HttpStatus.OK,
        message: 'Member moved to destination team successfully',
        data: {
          sourceTeam: {
            id: sourceTeam._id,
            name: sourceTeam.teamName,
            memberCount: updatedSourceTeam?.memberCount || sourceMemberCount,
            members: sourceTeamMembers
          },
          destinationTeam: {
            id: destinationTeam._id,
            name: destinationTeam.teamName,
            memberCount: updatedDestinationTeam?.memberCount || destinationMemberCountAfter,
            members: destinationTeamMembers
          },
          movedMember: {
            id: newTeamMember._id,
            userId: memberUserId,
            email: memberEmail,
            isAdmin: memberIsAdmin,
            status: memberStatus,
            previousTeamId: teamId,
            newTeamId: moveTeamId
          }
        }
      };
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to move member to team',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async removeAdmin(adminUserId: string, organizationId: string | undefined, requesterUserId: string) {
    try {
      // await this.assertNonIndividualUser(requesterUserId);
      
      // Step 0: Validate inputs - trim whitespace
      const trimmedAdminUserId = adminUserId?.trim();
      const trimmedOrganizationId = organizationId?.trim();
      const trimmedRequesterUserId = requesterUserId?.trim();
      
      if (!trimmedRequesterUserId || !isValidObjectId(trimmedRequesterUserId)) {
        throw new BadRequestException('Invalid requester user ID');
      }

      // Step 1: Validate Requester (the one making the request) - must be superAdmin or admin
      const requester = await this.userModel.findById(trimmedRequesterUserId);
      if (!requester) {
        throw new NotFoundException('Requester user not found');
      }

      // Step 2: Check authorization - only superAdmin or admin can remove admins
      if (requester.userType !== 'superAdmin' && requester.userType !== 'admin') {
        throw new ForbiddenException('Only superAdmin or admin users can remove admins from the organization');
      }

      // Step 3: If organizationId is not provided, derive it from requester
      let effectiveOrganizationId = trimmedOrganizationId;
      
      if (!effectiveOrganizationId) {
        if (requester.userType === 'admin') {
          // If requester is an admin, get organization from their organization field
          if (!requester.organization) {
            throw new BadRequestException('Admin user does not have an organization. Organization ID is required.');
          }
          effectiveOrganizationId = requester.organization.toString();
        } else if (requester.userType === 'superAdmin') {
          // Get superAdmin's first created organization
          const createdOrganization = await this.organizationModel.findOne({ creatorId: trimmedRequesterUserId });
          if (!createdOrganization) {
            throw new BadRequestException('SuperAdmin has not created any organization. Organization ID is required.');
          }
          effectiveOrganizationId = createdOrganization._id.toString();
        }
      }

      // Validate organization ID
      if (!isValidObjectId(effectiveOrganizationId)) {
        throw new BadRequestException('Invalid organization ID');
      }

      // Step 4: Validate Organization
      const organization = await this.organizationModel.findById(effectiveOrganizationId);
      if (!organization) {
        throw new NotFoundException('Organization not found');
      }

      // Step 5: Check authorization based on requester type
      if (requester.userType === 'superAdmin') {
        // For superAdmin, verify they created this organization
        if (organization.creatorId.toString() !== trimmedRequesterUserId) {
          throw new ForbiddenException('Only the organization creator (superAdmin) can remove admins');
        }
      } else if (requester.userType === 'admin') {
        // For admin, verify they belong to this organization
        if (!requester.organization || requester.organization.toString() !== effectiveOrganizationId) {
          throw new ForbiddenException('You are not authorized to remove admins from this organization');
        }
      }

      // Step 6: Check if adminUserId is a valid ObjectId (for approved admins) or AdminCreation ID (for pending admins)
      let adminUser: UserDocument | null = null;
      let pendingAdminCreation: AdminCreation | null = null;
      let approvedAdminCreation: AdminCreation | null = null;
      let isPendingAdmin = false;

      // First, try to find as approved admin in User table
      if (isValidObjectId(trimmedAdminUserId)) {
        adminUser = await this.userModel.findById(trimmedAdminUserId);
      }

      // If found in User table, also check for AdminCreation record (approved status)
      if (adminUser && adminUser.userType === 'admin') {
        approvedAdminCreation = await this.adminCreationModel.findOne({
          createdAdmin: trimmedAdminUserId,
          organization: effectiveOrganizationId,
          status: 'approved'
        });
      }

      // If not found in User table, check if it's a pending admin in AdminCreation table
      if (!adminUser) {
        // First try to find by AdminCreation _id
        pendingAdminCreation = await this.adminCreationModel.findOne({
          _id: trimmedAdminUserId,
          organization: effectiveOrganizationId,
          status: 'pending'
        });
        
        if (pendingAdminCreation) {
          isPendingAdmin = true;
        } else {
          // Also check all pending admins to match by _id
          const allPendingAdmins = await this.adminCreationModel.find({
            organization: effectiveOrganizationId,
            status: 'pending'
          }).exec();
          
          // Check if trimmedAdminUserId matches any AdminCreation _id
          for (const pending of allPendingAdmins) {
            if (pending._id.toString() === trimmedAdminUserId) {
              pendingAdminCreation = pending;
              isPendingAdmin = true;
              break;
            }
          }
        }
      }

      // Step 7: Handle pending admin removal
      if (isPendingAdmin && pendingAdminCreation) {
        // Prevent removing yourself (if requester is also pending - though unlikely)
        if (pendingAdminCreation.email && requester.email && pendingAdminCreation.email.toLowerCase() === requester.email.toLowerCase()) {
          throw new BadRequestException('You cannot remove yourself');
        }

        // Delete the pending AdminCreation record
        await this.adminCreationModel.findByIdAndDelete(pendingAdminCreation._id);

        // Get updated list of admins (approved + pending)
        const remainingApprovedAdmins = await this.userModel.find({
          userType: 'admin',
          organization: effectiveOrganizationId
        }).select('name email _id').exec();

        const remainingPendingAdmins = await this.adminCreationModel.find({
          organization: effectiveOrganizationId,
          status: 'pending'
        }).select('name email _id').exec();

        return {
          statusCode: HttpStatus.OK,
          message: 'Pending admin invitation removed from organization successfully',
          data: {
            removedAdmin: {
              id: pendingAdminCreation._id,
              email: pendingAdminCreation.email || null,
              name: pendingAdminCreation.name || null,
              status: 'pending'
            },
            organization: {
              id: organization._id,
              name: organization.name
            },
            remainingAdmins: [
              ...remainingApprovedAdmins.map(admin => ({
                id: admin._id,
                email: admin.email,
                name: admin.name,
                status: 'approved'
              })),
              ...remainingPendingAdmins.map(admin => ({
                id: admin._id,
                email: admin.email,
                name: admin.name || null,
                status: 'pending'
              }))
            ],
            totalRemainingAdmins: remainingApprovedAdmins.length + remainingPendingAdmins.length
          }
        };
      }

      // Step 8: Handle approved admin removal (status="approved")
      if (!adminUser) {
        throw new NotFoundException('Admin user or pending admin invitation not found');
      }

      // Step 9: Verify that the user is actually an admin
      if (adminUser.userType !== 'admin') {
        throw new BadRequestException('User is not an admin');
      }

      // Step 10: Verify that the admin belongs to this organization
      if (!adminUser.organization || adminUser.organization.toString() !== effectiveOrganizationId) {
        throw new BadRequestException('Admin does not belong to this organization');
      }

      // Step 11: Prevent removing yourself
      if (trimmedAdminUserId === trimmedRequesterUserId) {
        throw new BadRequestException('You cannot remove yourself');
      }

      // Step 12: Permanently delete the admin user from User table
      await this.userModel.findByIdAndDelete(trimmedAdminUserId);

      // Step 13: Permanently delete all AdminCreation records (both pending and approved status) for this admin and organization
      await this.adminCreationModel.deleteMany({
        createdAdmin: trimmedAdminUserId,
        organization: effectiveOrganizationId
      });

      // Step 14: Get updated list of admins in the organization (approved + pending)
      const remainingApprovedAdmins = await this.userModel.find({
        userType: 'admin',
        organization: effectiveOrganizationId
      }).select('name email _id').exec();

      const remainingPendingAdmins = await this.adminCreationModel.find({
        organization: effectiveOrganizationId,
        status: 'pending'
      }).select('name email _id').exec();

      return {
        statusCode: HttpStatus.OK,
        message: 'Admin removed from organization successfully',
        data: {
          removedAdmin: {
            id: adminUser._id,
            email: adminUser.email,
            name: adminUser.name,
            status: 'approved'
          },
          organization: {
            id: organization._id,
            name: organization.name
          },
          remainingAdmins: [
            ...remainingApprovedAdmins.map(admin => ({
              id: admin._id,
              email: admin.email,
              name: admin.name,
              status: 'approved'
            })),
            ...remainingPendingAdmins.map(admin => ({
              id: admin._id,
              email: admin.email,
              name: admin.name || null,
              status: 'pending'
            }))
          ],
          totalRemainingAdmins: remainingApprovedAdmins.length + remainingPendingAdmins.length
        }
      };
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to remove admin from organization',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getAdmin(userId: string, organizationId: string | undefined, name?: string, status?: string) {
    try {
      // Step 0: Validate inputs
      if (!isValidObjectId(userId)) {
        throw new BadRequestException('Invalid user ID');
      }

      // Step 1: Validate User
      const user = await this.userModel.findById(userId);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Step 2: Check authorization - only superAdmin or admin can access
      if (user.userType !== 'superAdmin' && user.userType !== 'admin') {
        throw new ForbiddenException('Only superAdmin or admin users can access this API');
      }

      // Step 3: If organizationId is not provided, derive it from user
      let effectiveOrganizationId = organizationId;
      
      if (!effectiveOrganizationId) {
        if (user.userType === 'admin') {
          // If user is an admin, get organization from their organization field
          if (!user.organization) {
            throw new BadRequestException('Admin user does not have an organization. Organization ID is required.');
          }
          effectiveOrganizationId = user.organization.toString();
        } else if (user.userType === 'superAdmin') {
          // If user is superAdmin, get their first created organization
          const createdOrganization = await this.organizationModel.findOne({ creatorId: userId });
          if (!createdOrganization) {
            throw new BadRequestException('SuperAdmin has not created any organization. Organization ID is required.');
          }
          effectiveOrganizationId = createdOrganization._id.toString();
        } else {
          throw new BadRequestException('Organization ID is required for this user type.');
        }
      }

      // Validate organization ID
      if (!isValidObjectId(effectiveOrganizationId)) {
        throw new BadRequestException('Invalid organization ID');
      }

      // Step 4: Validate Organization
      const organization = await this.organizationModel.findById(effectiveOrganizationId);
      if (!organization) {
        throw new NotFoundException('Organization not found');
      }

      // Step 5: Check if user has access to this organization
      if (user.userType === 'superAdmin') {
        // For superAdmin, verify they created this organization
        if (organization.creatorId.toString() !== userId) {
          throw new ForbiddenException('You are not authorized to view admins of this organization');
        }
      } else if (user.userType === 'admin') {
        // For admin, verify they belong to this organization
        if (!user.organization || user.organization.toString() !== effectiveOrganizationId) {
          throw new ForbiddenException('You are not authorized to view admins of this organization');
        }
      }

      // Step 6: Get all AdminCreation records for this organization
      const adminCreationQuery: any = {
        organization: effectiveOrganizationId
      };

      // Apply status filter to AdminCreation query if provided
      if (status && status.trim()) {
        const statusLower = status.trim().toLowerCase();
        if (statusLower === 'pending' || statusLower === 'approved') {
          adminCreationQuery.status = statusLower;
        }
      }

      const allAdminCreations = await this.adminCreationModel
        .find(adminCreationQuery)
        .select('createdAdmin email name status createdAt')
        .sort({ createdAt: -1 })
        .lean()
        .exec();

      // Step 7: Separate pending and approved AdminCreation records
      // Pending: status is 'pending' and createdAdmin is null (not registered yet)
      const pendingAdminCreations = allAdminCreations.filter((ac: any) => 
        ac.status === 'pending' && !ac.createdAdmin
      );
      // Approved: status is 'approved' and has createdAdmin (registered user)
      const approvedAdminCreationIds = allAdminCreations
        .filter((ac: any) => ac.createdAdmin && ac.status === 'approved')
        .map((ac: any) => ac.createdAdmin.toString());

      // Step 8: Get approved admins from User table
      const adminQuery: any = {
        userType: 'admin',
        organization: effectiveOrganizationId
      };

      // Apply status filter logic
      if (status && status.trim().toLowerCase() === 'approved') {
        // If filtering for approved, only get admins with approved AdminCreation records
        if (approvedAdminCreationIds.length > 0) {
          adminQuery._id = { $in: approvedAdminCreationIds };
        } else {
          // No approved AdminCreations exist, return empty
          adminQuery._id = { $in: [] };
        }
      } else if (status && status.trim().toLowerCase() === 'pending') {
        // If filtering for pending, don't query User table at all (pending admins aren't in User table yet)
        adminQuery._id = { $in: [] };
      }
      // If no status filter, get all admins from User table (they will be matched with AdminCreation records later)

      // Add name filter if provided (case-insensitive partial match)
      if (name && name.trim()) {
        adminQuery.name = { $regex: name.trim(), $options: 'i' };
      }

      const approvedAdmins = await this.userModel
        .find(adminQuery)
        .select('name email _id createdAt profileImage status')
        .sort({ createdAt: -1 })
        .lean()
        .exec();

      // Step 9: Create a map of AdminCreation records by email and createdAdmin
      const adminCreationByEmailMap = new Map<string, any>();
      const adminCreationByUserIdMap = new Map<string, any>();
      
      allAdminCreations.forEach((ac: any) => {
        if (ac.email) {
          adminCreationByEmailMap.set(ac.email.toLowerCase(), ac);
        }
        if (ac.createdAdmin) {
          adminCreationByUserIdMap.set(ac.createdAdmin.toString(), ac);
        }
      });

      // Step 10: Format approved admins (from User table)
      const formattedApprovedAdmins = approvedAdmins.map((admin: any) => {
        const adminCreation = adminCreationByUserIdMap.get(admin._id.toString());
        return {
          id: admin._id,
          email: admin.email,
          name: admin.name,
          profileImage: admin.profileImage || null,
          invitationStatus: adminCreation?.status || 'approved',
          createdAt: admin.createdAt
        };
      });

      // Step 11: Format pending admins (from AdminCreation table only, not in User table yet)
      const formattedPendingAdmins = pendingAdminCreations
        .filter((ac: any) => {
          // Only include if name filter matches (if provided)
          if (name && name.trim()) {
            const acName = ac.name || '';
            return acName.toLowerCase().includes(name.trim().toLowerCase());
          }
          return true;
        })
        .map((ac: any) => {
          // Check if this email already exists as an approved admin
          const existingApprovedAdmin = approvedAdmins.find(
            (admin: any) => admin.email?.toLowerCase() === ac.email?.toLowerCase()
          );
          
          // Only include if not already in approved admins list
          if (!existingApprovedAdmin) {
            return {
              id: ac._id, // Use AdminCreation _id for pending admins
              email: ac.email,
              name: ac.name || null,
              profileImage: null, // Pending admins don't have profileImage yet
              invitationStatus: ac.status || 'pending',
              createdAt: ac.createdAt
            };
          }
          return null;
        })
        .filter((admin: any) => admin !== null); // Remove null entries

      // Step 12: Combine and sort all admins by createdAt (newest first)
      const allFormattedAdmins = [...formattedApprovedAdmins, ...formattedPendingAdmins].sort(
        (a: any, b: any) => {
          const dateA = new Date(a.createdAt).getTime();
          const dateB = new Date(b.createdAt).getTime();
          return dateB - dateA; // Descending order
        }
      );

      // Build filter applied object
      const filterApplied: any = {};
      if (name && name.trim()) {
        filterApplied.name = name.trim();
      }
      if (status && status.trim()) {
        filterApplied.status = status.trim();
      }

      return {
        statusCode: HttpStatus.OK,
        message: 'Admins retrieved successfully',
        data: {
          organization: {
            id: organization._id,
            name: organization.name
          },
          admins: allFormattedAdmins,
          totalAdmins: allFormattedAdmins.length,
          filterApplied: Object.keys(filterApplied).length > 0 ? filterApplied : null
        }
      };
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to retrieve admins',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getUserOrganizationDecks(
    userId: string,
    page: number = 1,
    limit: number = 10,
    category?: string,
    name?: string,
  ) {
    try {
      // await this.assertNonIndividualUser(userId);
      
      // Step 0: Validate input
      if (!isValidObjectId(userId)) {
        throw new BadRequestException('Invalid user ID');
      }

      // Step 1: Validate User
      const user = await this.userModel.findById(userId);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Step 2: Find all organizations where user is a member
      const organizationIds: string[] = [];

      // Case 1: User is superAdmin - find all organizations they created
      if (user.userType === 'superAdmin') {
        const createdOrganizations = await this.organizationModel
          .find({ creatorId: userId })
          .select('_id')
          .exec();
        createdOrganizations.forEach(org => {
          organizationIds.push(org._id.toString());
        });
      }

      // Case 2: User is admin - find their organization
      if (user.userType === 'admin' && user.organization) {
        const orgId = user.organization.toString();
        if (!organizationIds.includes(orgId)) {
          organizationIds.push(orgId);
        }
      }

      // Case 3: User is a team member - find all organizations they belong to via teams
      const teamMemberships = await this.teamMemberModel
        .find({
          user: userId,
          status: 'approved'
        })
        .select('organization')
        .exec();

      teamMemberships.forEach(membership => {
        const orgId = membership.organization.toString();
        if (!organizationIds.includes(orgId)) {
          organizationIds.push(orgId);
        }
      });

      if (organizationIds.length === 0) {
        return {
          statusCode: HttpStatus.OK,
          message: 'User is not a member of any organization',
          data: {
            user: {
              id: user._id,
              email: user.email,
              name: user.name,
              role: user.role
            },
            organizations: [],
            decks: [],
            totalDecks: 0,
            page: page,
            limit: limit,
            totalPages: 0
          }
        };
      }

      // Step 3: For each organization, find all SuperAdmin and Admin users
      const allSuperAdminIds: string[] = [];
      const allAdminIds: string[] = [];

      for (const orgId of organizationIds) {
        const organization = await this.organizationModel.findById(orgId);
        if (!organization) continue;

        // Get the organization creator (superAdmin)
        if (organization.creatorId) {
          const creator = await this.userModel.findById(organization.creatorId);
          if (creator && creator.userType === 'superAdmin') {
            const creatorId = creator._id.toString();
            if (!allSuperAdminIds.includes(creatorId)) {
              allSuperAdminIds.push(creatorId);
            }
          }
        }

        // Get all admin users in this organization
        const adminUsers = await this.userModel.find({
          userType: 'admin',
          organization: orgId
        }).select('_id').exec();

        adminUsers.forEach(admin => {
          const adminId = admin._id.toString();
          if (!allAdminIds.includes(adminId)) {
            allAdminIds.push(adminId);
          }
        });
      }

      // Step 4: Combine all user IDs (SuperAdmin and Admin)
      const allUserIds = [...allSuperAdminIds, ...allAdminIds];

      if (allUserIds.length === 0) {
        return {
          statusCode: HttpStatus.OK,
          message: 'No SuperAdmin or Admin users found in user organizations',
          data: {
            user: {
              id: user._id,
              email: user.email,
              name: user.name,
              role: user.role
            },
            organizations: organizationIds.map(orgId => ({ id: orgId })),
            decks: [],
            totalDecks: 0,
            page: page,
            limit: limit,
            totalPages: 0
          }
        };
      }

      // Step 5: Build query for decks with category and name filters
      const skip = (page - 1) * limit;
      const deckQuery: any = {
        userId: { $in: allUserIds }
      };

      // Add category filter if provided
      if (category) {
        deckQuery.category = category;
      }

      // Add name filter if provided (case-insensitive partial match)
      if (name) {
        deckQuery.name = { $regex: name, $options: 'i' };
      }

      // Step 6: Get total count and decks with pagination
      const total = await this.deckModel.countDocuments(deckQuery).exec();
      const decks = await this.deckModel
        .find(deckQuery)
        .populate('userId', 'name email userType')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec();

      // Step 7: Fetch all topics and TopicProgress records upfront for optimization
      const allContentIds = decks.flatMap(d => d.contentIds || []);
      
      // Fetch all topics in a single query
      const allTopics = await this.topicModel
        .find({ _id: { $in: allContentIds } })
        .select('subTopics')
        .lean()
        .exec();

      // Create a map for quick topic lookup by ID
      const topicsMap = new Map<string, any>();
      allTopics.forEach((topic: any) => {
        const topicId = this.normalizeId(topic._id);
        if (topicId) {
          topicsMap.set(topicId, topic);
        }
      });

      // Fetch all TopicProgress records for this user and all topics in a single query
      const allTopicProgressRecords = await this.topicProgressModel
        .find({
          userId: userId,
          topicId: { $in: allContentIds }
        })
        .select('topicId completedSubTopicIds')
        .lean()
        .exec();

      // Create a map of completed subtopic IDs by topic ID
      const completedSubTopicsByTopic = new Map<string, Set<string>>();
      allTopicProgressRecords.forEach((progress: any) => {
        const topicId = this.normalizeId(progress.topicId);
        if (!topicId) return;

        if (!completedSubTopicsByTopic.has(topicId)) {
          completedSubTopicsByTopic.set(topicId, new Set<string>());
        }

        const completedSet = completedSubTopicsByTopic.get(topicId);
        if (progress.completedSubTopicIds && Array.isArray(progress.completedSubTopicIds)) {
          progress.completedSubTopicIds.forEach((subTopicId: any) => {
            const normalizedId = this.normalizeId(subTopicId);
            if (normalizedId) {
              completedSet!.add(normalizedId);
            }
          });
        }
      });

      // Step 8: Format the response with userPercentage calculation
      const formattedDecks = decks.map((deck: any) => {
        let creator: any = null;
        if (deck.userId && typeof deck.userId === 'object' && deck.userId._id) {
          creator = {
            id: deck.userId._id.toString(),
            name: deck.userId.name || null,
            email: deck.userId.email || null,
            userType: deck.userId.userType || null
          };
        }

        // Calculate userPercentage
        let userPercentage = 0;
        const contentIds = deck.contentIds || [];
        
        if (contentIds.length > 0) {
          // Get topics for this deck from the pre-fetched map
          const deckTopics = contentIds
            .map((id: any) => {
              const normalizedId = this.normalizeId(id);
              return normalizedId ? topicsMap.get(normalizedId) : null;
            })
            .filter((topic: any) => topic !== null);

          // Count total subtopics across all topics
          let totalSubtopics = 0;
          const allSubtopicIds: string[] = [];
          
          deckTopics.forEach((topic: any) => {
            if (topic.subTopics && Array.isArray(topic.subTopics)) {
              const subtopicIds = topic.subTopics.map((id: any) => 
                this.normalizeId(id)
              ).filter((id: string | null): id is string => !!id);
              allSubtopicIds.push(...subtopicIds);
              totalSubtopics += subtopicIds.length;
            }
          });

          // Count completed subtopics for this user
          let completedSubtopics = 0;
          if (totalSubtopics > 0 && allSubtopicIds.length > 0) {
            // Collect all completed subtopic IDs from pre-fetched data
            const completedSubTopicIds = new Set<string>();
            contentIds.forEach((topicId: any) => {
              const normalizedTopicId = this.normalizeId(topicId);
              if (normalizedTopicId) {
                const completedSet = completedSubTopicsByTopic.get(normalizedTopicId);
                if (completedSet) {
                  completedSet.forEach((subTopicId) => {
                    completedSubTopicIds.add(subTopicId);
                  });
                }
              }
            });

            // Count how many of the deck's subtopics are completed
            allSubtopicIds.forEach((subTopicId) => {
              if (completedSubTopicIds.has(subTopicId)) {
                completedSubtopics++;
              }
            });

            // Calculate percentage
            userPercentage = totalSubtopics > 0
              ? Math.round((completedSubtopics / totalSubtopics) * 100 * 100) / 100
              : 0;
          }
        }

        return {
          id: deck._id,
          name: deck.name,
          description: deck.description,
          category: deck.category,
          status: deck.status,
          isDefault: deck.isDefault,
          isPublic: deck.isPublic,
          contentIds: deck.contentIds,
          contentCount: deck.contentIds?.length || 0,
          creator: creator,
          userPercentage: userPercentage,
          createdAt: deck.createdAt,
          updatedAt: deck.updatedAt
        };
      });

      // Step 8: Get organization details for response
      const organizations = await this.organizationModel
        .find({ _id: { $in: organizationIds } })
        .select('name logo')
        .exec();

      const totalPages = Math.ceil(total / limit);

      return {
        statusCode: HttpStatus.OK,
        message: 'User organization decks retrieved successfully',
        data: {
          // user: {
          //   id: user._id,
          //   email: user.email,
          //   name: user.name,
          //   role: user.role
          // },
          // organizations: organizations.map(org => ({
          //   id: org._id,
          //   name: org.name,
          //   logo: org.logo
          // })),
          decks: formattedDecks,
          totalDecks: total,
          page: page,
          limit: limit,
          totalPages: totalPages
        }
      };
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to retrieve user organization decks',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Calculate topic-level accuracy from Game records for flashcard and battle games
   * @param userId - User ID to calculate accuracy for
   * @param subtopicIds - Array of subtopic IDs belonging to the topic
   * @returns Accuracy object with flashcard, battle, average, improvement, etc.
   */
  private async calculateTopicAccuracy(
    userId: string,
    subtopicIds: string[],
  ): Promise<{
    average: number;
    flashcard: number | null;
    battle: number | null;
    improvement: {
      percentage: number | null;
      status: string;
      message: string;
    };
    latest: null;
    totalGames: number;
    allEntries: Array<{
      type: string;
      accuracy: number;
      gamesPlayed: number;
    }>;
  }> {
    try {
      const normalizedUserId = this.normalizeId(userId);
      if (!normalizedUserId || subtopicIds.length === 0) {
        return {
          average: 0,
          flashcard: null,
          battle: null,
          improvement: {
            percentage: null,
            status: 'no_data',
            message: 'No games played for this topic',
          },
          latest: null,
          totalGames: 0,
          allEntries: [],
        };
      }

      // Query flashcard games (type='single' for single player flashcard games)
      const flashcardGames = await this.gameModel
        .find({
          type: 'single',
          subTopicId: { $in: subtopicIds },
          players: normalizedUserId,
          isCompleted: true,
        })
        .select('playerAnswers accuracy')
        .lean()
        .exec();

      // Query battle games (type='multiplayer' with gameMode for battle games)
      const battleGames = await this.gameModel
        .find({
          type: 'multiplayer',
          gameMode: { $in: ['duel', 'brawl', 'team'] },
          subTopicId: { $in: subtopicIds },
          players: normalizedUserId,
          isCompleted: true,
        })
        .select('playerAnswers accuracy')
        .lean()
        .exec();

      // Calculate flashcard accuracy
      let flashcardAccuracy: number | null = null;
      let flashcardGamesPlayed = 0;
      let flashcardCorrect = 0;
      let flashcardTotal = 0;

      if (flashcardGames.length > 0) {
        flashcardGamesPlayed = flashcardGames.length;
        
        // Calculate accuracy from playerAnswers (more accurate than using accuracy field)
        flashcardGames.forEach((game: any) => {
          if (game.playerAnswers && Array.isArray(game.playerAnswers)) {
            // Calculate from playerAnswers - the source of truth
            const userAnswers = game.playerAnswers.filter(
              (answer: any) => this.normalizeId(answer.userId) === normalizedUserId
            );
            if (userAnswers.length > 0) {
              const correct = userAnswers.filter((answer: any) => answer.isCorrect === true).length;
              flashcardCorrect += correct;
              flashcardTotal += userAnswers.length;
            }
          }
        });

        if (flashcardTotal > 0) {
          flashcardAccuracy = Math.round((flashcardCorrect / flashcardTotal) * 100 * 100) / 100;
        }
      }

      // Calculate battle accuracy
      let battleAccuracy: number | null = null;
      let battleGamesPlayed = 0;
      let battleCorrect = 0;
      let battleTotal = 0;

      if (battleGames.length > 0) {
        battleGamesPlayed = battleGames.length;
        
        // Calculate accuracy from playerAnswers (more accurate than using accuracy field)
        battleGames.forEach((game: any) => {
          if (game.playerAnswers && Array.isArray(game.playerAnswers)) {
            // Calculate from playerAnswers - the source of truth
            const userAnswers = game.playerAnswers.filter(
              (answer: any) => this.normalizeId(answer.userId) === normalizedUserId
            );
            if (userAnswers.length > 0) {
              const correct = userAnswers.filter((answer: any) => answer.isCorrect === true).length;
              battleCorrect += correct;
              battleTotal += userAnswers.length;
            }
          }
        });

        if (battleTotal > 0) {
          battleAccuracy = Math.round((battleCorrect / battleTotal) * 100 * 100) / 100;
        }
      }

      // Calculate average accuracy
      const accuracies = [flashcardAccuracy, battleAccuracy].filter(
        (val) => typeof val === 'number',
      ) as number[];
      
      const average =
        accuracies.length > 0
          ? Math.round(
              (accuracies.reduce((sum, val) => sum + val, 0) / accuracies.length) * 100,
            ) / 100
          : 0;

      // Calculate improvement percentage
      let improvementPercentage: number | null = null;
      let improvementStatus = 'no_data';
      let improvementMessage = 'Need both flashcard and battle data to calculate improvement';

      if (
        typeof flashcardAccuracy === 'number' &&
        typeof battleAccuracy === 'number' &&
        battleAccuracy > 0
      ) {
        improvementPercentage =
          Math.round(((flashcardAccuracy / battleAccuracy) * 100) * 100) / 100;
        improvementStatus = 'calculated';
        improvementMessage = 'Improvement calculated using flashcard/battle';
      }

      // Build allEntries array
      const allEntries: Array<{
        type: string;
        accuracy: number;
        gamesPlayed: number;
      }> = [];
      
      if (flashcardAccuracy !== null) {
        allEntries.push({
          type: 'flashcard',
          accuracy: flashcardAccuracy,
          gamesPlayed: flashcardGamesPlayed,
        });
      }
      
      if (battleAccuracy !== null) {
        allEntries.push({
          type: 'battle',
          accuracy: battleAccuracy,
          gamesPlayed: battleGamesPlayed,
        });
      }

      return {
        average,
        flashcard: flashcardAccuracy,
        battle: battleAccuracy,
        improvement: {
          percentage: improvementPercentage,
          status: improvementStatus,
          message: improvementMessage,
        },
        latest: null,
        totalGames: flashcardGamesPlayed + battleGamesPlayed,
        allEntries,
      };
    } catch (error) {
      console.error('Error calculating topic accuracy:', error);
      return {
        average: 0,
        flashcard: null,
        battle: null,
        improvement: {
          percentage: null,
          status: 'error',
          message: 'Error calculating topic accuracy',
        },
        latest: null,
        totalGames: 0,
        allEntries: [],
      };
    }
  }

  /**
   * Fetch decks for the user's organizations with accuracy/improvement stats.
   * Optional searchTerm filters decks by name (case-insensitive).
   * 
   * Logic:
   * - For superAdmin/admin: userId is optional. If provided, show that user's data; otherwise show requester's data.
   * - For member: userId is not allowed. Always use requester's userId from token. Only searchTerm is allowed.
   */
  async getKnowledgeImprovementDecks(
    requesterUserId: string,
    targetUserId?: string,
    searchTerm?: string,
  ) {
    try {
      // await this.assertNonIndividualUser(requesterUserId);
      
      // Step 1: Validate requester user first
      if (!isValidObjectId(requesterUserId)) {
        throw new BadRequestException('Invalid requester user ID');
      }

      const requesterUser = await this.userModel.findById(requesterUserId);
      if (!requesterUser) {
        throw new NotFoundException('Requester user not found');
      }

      // Step 2: Determine effective userId based on requester's userType
      let effectiveUserId: string;

      if (requesterUser.userType === 'member') {
        // For members: always use requester's userId, ignore targetUserId
        effectiveUserId = requesterUserId;
        
        // If member tries to provide targetUserId, throw error
        if (targetUserId && targetUserId.trim()) {
          throw new BadRequestException('Members cannot specify userId. Only searchTerm is allowed.');
        }
      } else if (requesterUser.userType === 'superAdmin' || requesterUser.userType === 'admin') {
        // For superAdmin/admin: use targetUserId if provided, otherwise use requesterUserId
        const trimmedTargetUserId = targetUserId?.trim();
        
        if (trimmedTargetUserId) {
          // Validate targetUserId
          if (!isValidObjectId(trimmedTargetUserId)) {
            throw new BadRequestException('Invalid target user ID');
          }
          effectiveUserId = trimmedTargetUserId;
        } else {
          // No targetUserId provided, use requester's userId
          effectiveUserId = requesterUserId;
        }
      } else {
        throw new ForbiddenException('Invalid user type. Only superAdmin, admin, or member can access this API.');
      }

      // Step 3: Validate and get the target user (the one whose data we're fetching)
      if (!isValidObjectId(effectiveUserId)) {
        throw new BadRequestException('Invalid effective user ID');
      }

      const user = await this.userModel.findById(effectiveUserId);
      if (!user) {
        throw new NotFoundException('Target user not found');
      }

      // Gather organizations the user is associated with (creator, admin, or member)
      const organizationIds: string[] = [];

      if (user.userType === 'superAdmin') {
        const createdOrganizations = await this.organizationModel
          .find({ creatorId: effectiveUserId })
          .select('_id name')
          .lean()
          .exec();
        createdOrganizations.forEach((org) => {
          const orgId = this.normalizeId(org._id);
          if (orgId && !organizationIds.includes(orgId)) {
            organizationIds.push(orgId);
          }
        });
      }

      if (user.userType === 'admin' && user.organization) {
        const orgId = this.normalizeId(user.organization);
        if (orgId && !organizationIds.includes(orgId)) {
          organizationIds.push(orgId);
        }
      }

      const teamMemberships = await this.teamMemberModel
        .find({ user: effectiveUserId, status: 'approved' })
        .select('organization')
        .lean()
        .exec();

      teamMemberships.forEach((membership) => {
        const orgId = this.normalizeId((membership as any).organization);
        if (orgId && !organizationIds.includes(orgId)) {
          organizationIds.push(orgId);
        }
      });

      if (organizationIds.length === 0) {
        return {
          message: 'Knowledge improvement decks fetched successfully',
          usertype: user.userType,
          organizationId: null,
          organizationName: null,
          searchTerm: searchTerm ?? null,
          accuracy: '0.00',
          rank: null,
          decks: [],
        };
      }

      // Fetch organization documents (use the first one for top-level metadata)
      // Need creatorId to include the org creator (superAdmin) as a deck owner
      const organizations = await this.organizationModel
        .find({ _id: { $in: organizationIds } })
        .select('_id name creatorId')
        .lean()
        .exec();

      const primaryOrg = organizations[0];

      // Collect superAdmin (creator) and admin user IDs for these orgs
      const superAdminIds: string[] = [];
      const adminIds: string[] = [];

      for (const org of organizations) {
        const orgId = this.normalizeId(org._id);
        if (!orgId) continue;

        // Organization creator (superAdmin)
        const creator = await this.userModel
          .findById((org as any).creatorId)
          .select('_id userType')
          .lean();
        if (creator && creator.userType === 'superAdmin') {
          const creatorId = this.normalizeId(creator._id);
          if (creatorId && !superAdminIds.includes(creatorId)) {
            superAdminIds.push(creatorId);
          }
        }

        // Admins of this organization
        const admins = await this.userModel
          .find({ userType: 'admin', organization: orgId })
          .select('_id')
          .lean()
          .exec();
        admins.forEach((admin) => {
          const adminId = this.normalizeId(admin._id);
          if (adminId && !adminIds.includes(adminId)) {
            adminIds.push(adminId);
          }
        });
      }

      const allOwnerIds = [...superAdminIds, ...adminIds];

      if (allOwnerIds.length === 0) {
        // Calculate user accuracy and rank even when no decks exist
        let userAccuracy = 0;
        let userRank: number | null = null;
        
        if (user.userType === 'member') {
          try {
            const teamMember = await this.teamMemberModel
              .findOne({ 
                user: effectiveUserId,
                status: 'approved'
              })
              .lean()
              .exec();

            if (teamMember) {
              userAccuracy = (teamMember as any).gameAccuracy || 0;

              const teamId = this.normalizeId((teamMember as any).team);
              if (teamId && isValidObjectId(teamId)) {
                const allTeamMembers = await this.teamMemberModel
                  .find({ 
                    team: teamId,
                    status: 'approved'
                  })
                  .populate('user', '_id')
                  .lean()
                  .exec();

                // Collect all valid user IDs
                const memberUserIds = allTeamMembers
                  .map((m: any) => m.user && typeof m.user === 'object' && m.user._id
                    ? this.normalizeId(m.user._id)
                    : null)
                  .filter((id: string | null): id is string => id !== null && isValidObjectId(id))
                  .map((id: string) => new Types.ObjectId(id));

                // Single aggregation query for all members
                let allPoints: any[] = [];
                if (memberUserIds.length > 0) {
                  try {
                    allPoints = await this.teamGameScoreModel.aggregate([
                      {
                        $match: {
                          userId: { $in: memberUserIds },
                          teamId: new Types.ObjectId(teamId)
                        }
                      },
                      {
                        $group: {
                          _id: '$userId',
                          totalPoints: { $sum: '$points' }
                        }
                      }
                    ]);
                  } catch (err) {
                    console.error('Error calculating points for members:', err);
                  }
                }

                // Create a map of userId to totalPoints
                const pointsMap = new Map<string, number>();
                allPoints.forEach((result: any) => {
                  const userId = this.normalizeId(result._id);
                  if (userId) {
                    pointsMap.set(userId, result.totalPoints || 0);
                  }
                });

                // Map members with their points
                const membersWithPoints = allTeamMembers.map((member: any) => {
                  const memberUserId = member.user && typeof member.user === 'object' && member.user._id
                    ? this.normalizeId(member.user._id)
                    : null;
                  const totalPoints = memberUserId ? (pointsMap.get(memberUserId) || 0) : 0;

                  return {
                    userId: memberUserId,
                    totalPoints: totalPoints
                  };
                });

                membersWithPoints.sort((a, b) => b.totalPoints - a.totalPoints);
                
                const normalizedEffectiveUserId = this.normalizeId(effectiveUserId);
                const userIndex = membersWithPoints.findIndex(
                  (m) => m.userId && m.userId === normalizedEffectiveUserId
                );
                
                if (userIndex !== -1) {
                  userRank = userIndex + 1;
                }
              }
            }
          } catch (err) {
            console.error('Error calculating accuracy and rank:', err);
            userAccuracy = 0;
            userRank = null;
          }
        }

        return {
          message: 'Knowledge improvement decks fetched successfully',
          usertype: user.userType,
          organizationId: this.normalizeId(primaryOrg?._id),
          organizationName: (primaryOrg as any)?.name || null,
          searchTerm: searchTerm ?? null,
          accuracy: userAccuracy.toFixed(2),
          rank: userRank,
          decks: [],
        };
      }

      const deckQuery: any = { userId: { $in: allOwnerIds } };
      if (searchTerm) {
        deckQuery.name = { $regex: searchTerm, $options: 'i' };
      }

      const decks = await this.deckModel.find(deckQuery).lean().exec();

      // Get the latest TeamGameScore for the user to retrieve averageResponseTime
      let averageResponseTime = 0;
      try {
        const latestTeamGameScore = await this.teamGameScoreModel
          .findOne({ userId: effectiveUserId })
          .sort({ updatedAt: -1 })
          .select('averageResponseTime')
          .lean()
          .exec();
        
        if (latestTeamGameScore) {
          averageResponseTime = latestTeamGameScore.averageResponseTime || 0;
        }
      } catch (err) {
        // If error occurs, default to 0
        averageResponseTime = 0;
      }

      // Process decks and build topic-wise accuracy from topics table (optimization: batch fetch all topics)
      // 1. Collect all unique topic IDs from all decks
      const allTopicIdsSet = new Set<string>();
      decks.forEach((deck: any) => {
        const topicIds = (deck.contentIds || []).filter((id: any) => id);
        topicIds.forEach((id: any) => {
          const normalizedId = this.normalizeId(id);
          if (normalizedId) {
            allTopicIdsSet.add(normalizedId);
          }
        });
      });

      const allTopicIds = Array.from(allTopicIdsSet);

      // 2. Batch fetch all topics at once
      const allTopics = await this.topicModel
        .find({ _id: { $in: allTopicIds } })
        .select('_id title subTopics flashcardAccuracies battleAccuracies')
        .lean()
        .exec();

      // 3. Create a map of topics by ID
      const topicsMap = new Map<string, any>();
      allTopics.forEach((topic: any) => {
        const topicId = this.normalizeId(topic._id);
        if (topicId) {
          topicsMap.set(topicId, topic);
        }
      });

      // 3.5. OPTIMIZATION: Pre-process all accuracy arrays into Maps for O(1) lookup
      // Create Maps: key = `${topicId}:${userId}`, value = accuracy
      const flashcardAccuracyMap = new Map<string, number>();
      const battleAccuracyMap = new Map<string, number>();
      
      allTopics.forEach((topic: any) => {
        const topicId = this.normalizeId(topic._id);
        if (!topicId) return;

        // Process flashcard accuracies
        if (topic.flashcardAccuracies && Array.isArray(topic.flashcardAccuracies)) {
          topic.flashcardAccuracies.forEach((entry: any) => {
            const userId = this.normalizeId(entry.userId);
            if (userId) {
              const key = `${topicId}:${userId}`;
              flashcardAccuracyMap.set(key, entry.accuracy || 0);
            }
          });
        }

        // Process battle accuracies
        if (topic.battleAccuracies && Array.isArray(topic.battleAccuracies)) {
          topic.battleAccuracies.forEach((entry: any) => {
            const userId = this.normalizeId(entry.userId);
            if (userId) {
              const key = `${topicId}:${userId}`;
              battleAccuracyMap.set(key, entry.accuracy || 0);
            }
          });
        }
      });

      // 4. Process decks and map topics from the pre-fetched map
      const responseDecks = decks.map((deck: any) => {
        // Get all topics for this deck
        const topicIds = (deck.contentIds || []).filter((id: any) => id);
        
        // Build topics array with accuracy per topic from pre-fetched topics map
        const topicsWithAccuracy = topicIds.map((topicId: any) => {
          const normalizedTopicId = this.normalizeId(topicId);
          if (!normalizedTopicId) {
            return {
              topicId: null,
              title: null,
              flashcardAccuracy: 0,
              battleAccuracy: 0,
              improvementPercentage: 0,
            };
          }

          const topic = topicsMap.get(normalizedTopicId);
          if (!topic) {
            return {
              topicId: normalizedTopicId,
              title: null,
              flashcardAccuracy: 0,
              battleAccuracy: 0,
              improvementPercentage: 0,
            };
          }
          
          // OPTIMIZATION: Use Map.get() instead of array.find() - O(1) vs O(n)
          const accuracyKey = `${normalizedTopicId}:${effectiveUserId}`;
          const flashAccuracy = flashcardAccuracyMap.get(accuracyKey) ?? 0;
          const battleAccuracy = battleAccuracyMap.get(accuracyKey) ?? 0;

          // Calculate improvement percentage (battleAccuracy/flashcardAccuracy * 100)
          let improvementPercentage = 0;
          if (flashAccuracy > 0) {
            improvementPercentage = Math.round((battleAccuracy / flashAccuracy) * 100 * 100) / 100;
          }
          
          return {
            topicId: normalizedTopicId,
            title: topic.title || null,
            flashcardAccuracy: flashAccuracy,
            battleAccuracy: battleAccuracy,
            improvementPercentage: improvementPercentage,
          };
        });

        return {
          deckId: this.normalizeId(deck._id),
          name: deck.name,
          description: deck.description ?? null,
          category: deck.category ?? null,
          topics: topicsWithAccuracy,
          averageResponseTime: averageResponseTime,
        };
      });

      // Calculate user accuracy from TeamMember's gameAccuracy field
      let userAccuracy = 0;
      let userRank: number | null = null;
      
      // Only calculate accuracy and rank for members (not superAdmin/admin)
      if (user.userType === 'member') {
        try {
          // Get TeamMember record to get gameAccuracy
          const teamMember = await this.teamMemberModel
            .findOne({ 
              user: effectiveUserId,
              status: 'approved'
            })
            .lean()
            .exec();

          if (teamMember) {
            // Get accuracy from TeamMember's gameAccuracy field
            userAccuracy = (teamMember as any).gameAccuracy || 0;

            // Get the team for this member
            const teamId = this.normalizeId((teamMember as any).team);
            if (teamId && isValidObjectId(teamId)) {
              // Get all approved members of this team
              const allTeamMembers = await this.teamMemberModel
                .find({ 
                  team: teamId,
                  status: 'approved'
                })
                .populate('user', '_id')
                .lean()
                .exec();

              // Collect all valid user IDs
              const memberUserIds = allTeamMembers
                .map((m: any) => m.user && typeof m.user === 'object' && m.user._id
                  ? this.normalizeId(m.user._id)
                  : null)
                .filter((id: string | null): id is string => id !== null && isValidObjectId(id))
                .map((id: string) => new Types.ObjectId(id));

              // Single aggregation query for all members
              let allPoints: any[] = [];
              if (memberUserIds.length > 0) {
                try {
                  allPoints = await this.teamGameScoreModel.aggregate([
                    {
                      $match: {
                        userId: { $in: memberUserIds },
                        teamId: new Types.ObjectId(teamId)
                      }
                    },
                    {
                      $group: {
                        _id: '$userId',
                        totalPoints: { $sum: '$points' }
                      }
                    }
                  ]);
                } catch (err) {
                  // If aggregation fails, allPoints remains empty
                  console.error('Error calculating points for members:', err);
                }
              }

              // Create a map of userId to totalPoints
              const pointsMap = new Map<string, number>();
              allPoints.forEach((result: any) => {
                const userId = this.normalizeId(result._id);
                if (userId) {
                  pointsMap.set(userId, result.totalPoints || 0);
                }
              });

              // Map members with their points
              const membersWithPoints = allTeamMembers.map((member: any) => {
                const memberUserId = member.user && typeof member.user === 'object' && member.user._id
                  ? this.normalizeId(member.user._id)
                  : null;
                const totalPoints = memberUserId ? (pointsMap.get(memberUserId) || 0) : 0;

                return {
                  userId: memberUserId,
                  totalPoints: totalPoints
                };
              });

              // Sort by points (descending) and assign rank
              membersWithPoints.sort((a, b) => b.totalPoints - a.totalPoints);
              
              // Find the user's rank
              const normalizedEffectiveUserId = this.normalizeId(effectiveUserId);
              const userIndex = membersWithPoints.findIndex(
                (m) => m.userId && m.userId === normalizedEffectiveUserId
              );
              
              if (userIndex !== -1) {
                userRank = userIndex + 1;
              }
            }
          }
        } catch (err) {
          // If calculation fails, use default values
          console.error('Error calculating accuracy and rank:', err);
          userAccuracy = 0;
          userRank = null;
        }
      }

      return {
        message: 'Knowledge improvement decks fetched successfully',
        usertype: user.userType,
        organizationId: this.normalizeId(primaryOrg?._id),
        organizationName: (primaryOrg as any)?.name || null,
        searchTerm: searchTerm ?? null,
        accuracy: userAccuracy.toFixed(2),
        rank: userRank,
        decks: responseDecks,
      };
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to fetch knowledge improvement decks',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findOneTeam(teamId: string) {
    try {
      // Note: This method doesn't take userId, but it's called from controllers that should check userType
      // Step 0: Validate input
      if (!isValidObjectId(teamId)) {
        throw new BadRequestException('Invalid team ID');
      }

      // Step 1: Validate and get Team
      const team = await this.teamModel.findById(teamId);
      if (!team) {
        throw new NotFoundException('Team not found');
      }

      // Step 2: Get organization details
      const organization = await this.organizationModel.findById(team.organization);
      if (!organization) {
        throw new NotFoundException('Organization not found for this team');
      }

      // Step 3: Get creator details
      const creator = await this.userModel.findById(team.creator);
      if (!creator) {
        throw new NotFoundException('Team creator not found');
      }

      // Step 4: Get all team members
      const members = await this.teamMemberModel
        .find({ team: teamId })
        .populate('user', 'name email profileImage isOnline')
        .lean()
        .exec();

      // Step 5: Collect all valid user IDs and calculate total points from TeamGameScore
      const memberUserIds = members
        .map((m: any) => m.user && typeof m.user === 'object' && m.user._id
          ? new Types.ObjectId(m.user._id)
          : null)
        .filter((id: Types.ObjectId | null): id is Types.ObjectId => id !== null);

      // Single aggregation query for all members
      let allPoints: any[] = [];
      if (memberUserIds.length > 0) {
        try {
          allPoints = await this.teamGameScoreModel.aggregate([
            {
              $match: {
                userId: { $in: memberUserIds },
                teamId: team._id
              }
            },
            {
              $group: {
                _id: '$userId',
                totalPoints: { $sum: '$points' }
              }
            }
          ]);
        } catch (err) {
          console.error('Error calculating points for members:', err);
        }
      }

      // Create a map of userId to totalPoints
      const pointsMap = new Map<string, number>();
      allPoints.forEach((result: any) => {
        const userId = this.normalizeId(result._id);
        if (userId) {
          pointsMap.set(userId, result.totalPoints || 0);
        }
      });

      // Map members with their points
      const membersWithPoints = members.map((member: any) => {
        let userId = null;
        let totalPoints = 0;

        if (member.user && typeof member.user === 'object' && member.user._id) {
          userId = member.user._id;
          const normalizedUserId = this.normalizeId(userId);
          totalPoints = normalizedUserId ? (pointsMap.get(normalizedUserId) || 0) : 0;
        }

        return {
          id: this.normalizeId(member._id),
          userId: userId ? this.normalizeId(userId) : null,
          name: member.user?.name ?? null,
          email: member.user?.email ?? member.email ?? null,
          profileImage: member.user?.profileImage ?? null,
          isAdmin: member.isAdmin ?? false,
          status: member.status ?? null,
          joinedAt: member.joinedAt ?? null,
          points: totalPoints,
          isOnline: member.user?.isOnline ?? false
        };
      });

      // Step 6: Sort members by points (highest first, lowest last)
      membersWithPoints.sort((a, b) => {
        // Members with higher points come first
        return b.points - a.points;
      });

      // Step 6.5: Assign rank based on sorted order (1 = highest points)
      membersWithPoints.forEach((member, index) => {
        (member as any).rank = index + 1;
      });

      // Step 7: Sync memberCount and return response
      const actualMemberCount = await this.syncTeamMemberCount(teamId);
      const updatedTeam = await this.teamModel.findById(teamId);

      return {
        statusCode: HttpStatus.OK,
        message: 'Team retrieved successfully with members sorted by points',
        data: {
          team: {
            id: team._id,
            name: team.teamName,
            creator: {
              id: creator._id,
              email: creator.email,
              name: creator.name
            },
            organization: {
              id: organization._id,
              name: organization.name,
              logo: organization.logo
            },
            memberCount: updatedTeam?.memberCount || actualMemberCount,
            isActive: team.isActive,
            createdAt: team.createdAt
          },
          members: membersWithPoints,
          totalMembers: membersWithPoints.length
        }
      };
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to retrieve team',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getAllTeamsForUser(userId: string, status?: string, name?: string) {
    try {
      // Step 0: Validate input
      if (!isValidObjectId(userId)) {
        throw new BadRequestException('Invalid user ID');
      }

      // Validate status parameter if provided
      let statusFilter: string[] = ['approved', 'pending']; // Default: show both
      if (status && status.trim()) {
        const statusLower = status.trim().toLowerCase();
        if (statusLower === 'approved' || statusLower === 'pending') {
          statusFilter = [statusLower];
        } else {
          throw new BadRequestException('Invalid status. Status must be "approved" or "pending"');
        }
      }

      // Step 1: Validate User
      const user = await this.userModel.findById(userId);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Step 2: Find all organizations where user is a member
      const organizationIds: string[] = [];

      // Case 1: User is superAdmin - find all organizations they created
      if (user.userType === 'superAdmin') {
        const createdOrganizations = await this.organizationModel
          .find({ creatorId: userId })
          .select('_id name logo')
          .exec();
        createdOrganizations.forEach(org => {
          organizationIds.push(org._id.toString());
        });
      }

      // Case 2: User is admin - find their organization
      if (user.userType === 'admin' && user.organization) {
        const orgId = user.organization.toString();
        if (!organizationIds.includes(orgId)) {
          organizationIds.push(orgId);
        }
      }

      // Case 3: User is a team member - find organizations via teams
      const teamMemberships = await this.teamMemberModel
        .find({
          user: userId,
          status: 'approved'
        })
        .select('organization')
        .exec();

      teamMemberships.forEach(membership => {
        const orgId = membership.organization.toString();
        if (!organizationIds.includes(orgId)) {
          organizationIds.push(orgId);
        }
      });

      if (organizationIds.length === 0) {
        return {
          statusCode: HttpStatus.OK,
          message: 'User is not associated with any organization',
          data: {
            organizations: [],
            teams: []
          }
        };
      }

      // Step 3: Get all organizations with details
      const organizations = await this.organizationModel
        .find({ _id: { $in: organizationIds } })
        .select('_id name logo creatorId')
        .exec();

      // Step 4: Get all teams in these organizations with optional name filter
      const teamQuery: any = { organization: { $in: organizationIds } };
      
      // Add name filter if provided (case-insensitive partial match)
      if (name && name.trim()) {
        teamQuery.teamName = { $regex: name.trim(), $options: 'i' };
      }
      
      const teams = await this.teamModel
        .find(teamQuery)
        .lean()
        .exec();

      // Step 5: Batch fetch all data at once (optimization)
      const teamIds = teams.map((t: any) => t._id);
      const creatorIds = teams.map((t: any) => t.creator).filter((id: any) => id);

      // 1. Batch fetch all creators
      const allCreators = await this.userModel
        .find({ _id: { $in: creatorIds } })
        .select('_id name email')
        .lean()
        .exec();
      
      const creatorsMap = new Map<string, any>();
      allCreators.forEach((creator: any) => {
        const creatorId = this.normalizeId(creator._id);
        if (creatorId) {
          creatorsMap.set(creatorId, creator);
        }
      });

      // 2. Batch fetch all members for all teams (with status filter for display)
      const allMembers = await this.teamMemberModel
        .find({
          team: { $in: teamIds },
          status: { $in: statusFilter }
        })
        .populate('user', 'name email profileImage')
        .lean()
        .exec();

      // Also get total counts for each team (for memberCount - includes all statuses)
      const memberCountsByTeam = await this.teamMemberModel.aggregate([
        {
          $match: {
            team: { $in: teamIds }
          }
        },
        {
          $group: {
            _id: '$team',
            totalCount: { $sum: 1 }
          }
        }
      ]);

      const memberCountMap = new Map<string, number>();
      memberCountsByTeam.forEach((result: any) => {
        const teamId = this.normalizeId(result._id);
        if (teamId) {
          memberCountMap.set(teamId, result.totalCount || 0);
        }
      });

      // Group members by team
      const membersByTeam = new Map<string, any[]>();
      allMembers.forEach((member: any) => {
        const teamId = this.normalizeId(member.team);
        if (teamId) {
          if (!membersByTeam.has(teamId)) {
            membersByTeam.set(teamId, []);
          }
          membersByTeam.get(teamId)!.push(member);
        }
      });

      // 3. Collect all valid user IDs for approved members only (for points aggregation)
      const allApprovedMemberUserIds = allMembers
        .filter((m: any) => m.user && typeof m.user === 'object' && m.user._id && m.status === 'approved')
        .map((m: any) => new Types.ObjectId(m.user._id));

      // 4. Single aggregation query for all points (grouped by userId and teamId)
      let allPointsAggregation: any[] = [];
      if (allApprovedMemberUserIds.length > 0 && teamIds.length > 0) {
        try {
          allPointsAggregation = await this.teamGameScoreModel.aggregate([
            {
              $match: {
                userId: { $in: allApprovedMemberUserIds },
                teamId: { $in: teamIds }
              }
            },
            {
              $group: {
                _id: {
                  userId: '$userId',
                  teamId: '$teamId'
                },
                totalPoints: { $sum: '$points' }
              }
            }
          ]);
        } catch (err) {
          console.error('Error calculating points for members:', err);
        }
      }

      // Create a map of (userId, teamId) to totalPoints
      const pointsMap = new Map<string, number>();
      allPointsAggregation.forEach((result: any) => {
        const userId = this.normalizeId(result._id.userId);
        const teamId = this.normalizeId(result._id.teamId);
        if (userId && teamId) {
          const key = `${teamId}:${userId}`;
          pointsMap.set(key, result.totalPoints || 0);
        }
      });

      // Step 5: Process teams with members
      const teamsWithMembers = teams.map((team: any) => {
        // Get organization details for this team
        const teamOrg = organizations.find(
          org => org._id.toString() === team.organization.toString()
        );

        // Get creator from map
        const teamCreatorId = this.normalizeId(team.creator);
        const creator = teamCreatorId ? creatorsMap.get(teamCreatorId) : null;

        // Get members for this team
        const teamIdStr = team._id.toString();
        const members = membersByTeam.get(teamIdStr) || [];

        // Process members with points calculation
        const membersWithPoints = members.map((member: any) => {
          let totalPoints = 0;
          let userId = null;

          // Only calculate points for approved members with user accounts
          if (member.user && typeof member.user === 'object' && member.user._id && member.status === 'approved') {
            userId = member.user._id;
            const normalizedUserId = this.normalizeId(userId);
            if (normalizedUserId) {
              const key = `${teamIdStr}:${normalizedUserId}`;
              totalPoints = pointsMap.get(key) || 0;
            }
          }

          return {
            id: this.normalizeId(member._id),
            userId: userId ? this.normalizeId(userId) : null,
            name: member.user?.name ?? null,
            email: member.user?.email ?? member.email ?? null,
            profileImage: member.user?.profileImage ?? null,
            isAdmin: member.isAdmin ?? false,
            status: member.status ?? null,
            joinedAt: member.joinedAt ?? null,
            points: totalPoints
          };
        });

        // Sort members: approved first (by points desc), then pending
        membersWithPoints.sort((a, b) => {
          // First, sort by status: approved comes before pending
          if (a.status === 'approved' && b.status === 'pending') return -1;
          if (a.status === 'pending' && b.status === 'approved') return 1;
          // If same status, sort by points (highest first)
          return b.points - a.points;
        });

        // Assign rank
        membersWithPoints.forEach((member, index) => {
          (member as any).rank = index + 1;
        });

        // Get synced memberCount (total count of all members regardless of status filter)
        const actualMemberCount = memberCountMap.get(teamIdStr) || 0;

        return {
          id: team._id.toString(),
          name: team.teamName,
          creator: creator ? {
            id: creator._id.toString(),
            email: creator.email,
            name: creator.name
          } : null,
          organization: teamOrg ? {
            id: teamOrg._id.toString(),
            name: teamOrg.name,
            logo: teamOrg.logo
          } : null,
          memberCount: actualMemberCount,
          isActive: team.isActive,
          createdAt: team.createdAt,
          members: membersWithPoints,
          totalMembers: membersWithPoints.length
        };
      });

      // Sync member counts for all teams (update database with calculated counts)
      await Promise.all(
        teams.map(async (team: any) => {
          const teamIdStr = team._id.toString();
          const count = memberCountMap.get(teamIdStr) || 0;
          await this.teamModel.findByIdAndUpdate(teamIdStr, { memberCount: count });
        })
      );

      // Step 6: Format response with organizations and their teams
      const organizationsWithTeams = organizations.map(org => {
        const orgTeams = teamsWithMembers.filter(
          team => team.organization && team.organization.id === org._id.toString()
        );

        return {
          id: org._id.toString(),
          name: org.name,
          logo: org.logo,
          teams: orgTeams
        };
      });

      return {
        statusCode: HttpStatus.OK,
        message: 'All teams retrieved successfully for user organizations',
        data: {
          organizations: organizationsWithTeams,
          totalOrganizations: organizationsWithTeams.length,
          totalTeams: teamsWithMembers.length
        }
      };
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to retrieve teams for user',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getDashboard(userId: string) {
    try {
      // await this.assertNonIndividualUser(userId);
      
      // Step 0: Validate input
      if (!isValidObjectId(userId)) {
        throw new BadRequestException('Invalid user ID');
      }

      // Step 1: Validate User
      const user = await this.userModel.findById(userId);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Step 2: Find organization(s) the user belongs to
      let organizationIds: string[] = [];

      // Case 1: User is superAdmin - find organizations they created
      if (user.userType === 'superAdmin') {
        const createdOrganizations = await this.organizationModel
          .find({ creatorId: userId })
          .select('_id')
          .exec();
        organizationIds = createdOrganizations.map(org => org._id.toString());
      }

      // Case 2: User is admin - find their organization
      if (user.userType === 'admin' && user.organization) {
        const orgId = user.organization.toString();
        if (!organizationIds.includes(orgId)) {
          organizationIds.push(orgId);
        }
      }

      // Case 3: User is a team member - find organizations via teams
      const teamMemberships = await this.teamMemberModel
        .find({
          user: userId,
          status: 'approved'
        })
        .select('organization')
        .exec();

      teamMemberships.forEach(membership => {
        const orgId = membership.organization.toString();
        if (!organizationIds.includes(orgId)) {
          organizationIds.push(orgId);
        }
      });

      if (organizationIds.length === 0) {
        throw new NotFoundException('User is not associated with any organization');
      }

      // For now, we'll return data for the first organization (or you can modify to return all)
      const organizationId = organizationIds[0];
      const organization = await this.organizationModel.findById(organizationId);
      if (!organization) {
        throw new NotFoundException('Organization not found');
      }

      // Step 3: Get all teams in this organization
      const teams = await this.teamModel
        .find({ organization: organizationId })
        .lean()
        .exec();

      // Step 4: Batch fetch all data at once (optimization)
      const teamIds = teams.map((t: any) => t._id);

      // 1. Batch fetch all approved members for all teams
      const allMembers = await this.teamMemberModel
        .find({
          team: { $in: teamIds },
          status: 'approved'
        })
        .populate('user', 'name email profileImage')
        .lean()
        .exec();

      // Group members by team
      const membersByTeam = new Map<string, any[]>();
      allMembers.forEach((member: any) => {
        const teamId = this.normalizeId(member.team);
        if (teamId) {
          if (!membersByTeam.has(teamId)) {
            membersByTeam.set(teamId, []);
          }
          membersByTeam.get(teamId)!.push(member);
        }
      });

      // 2. Collect all member user IDs
      const allMemberUserIds = allMembers
        .filter((m: any) => m.user && typeof m.user === 'object' && m.user._id)
        .map((m: any) => this.normalizeId(m.user._id))
        .filter((id): id is string => id !== null && isValidObjectId(id));

      // 3. Batch fetch all GameProgress records
      const allGameProgress = await this.gameProgressModel
        .find({ userId: { $in: allMemberUserIds } })
        .lean()
        .exec();

      const gameProgressMap = new Map<string, any>();
      allGameProgress.forEach((gp: any) => {
        const userId = this.normalizeId(gp.userId);
        if (userId) {
          gameProgressMap.set(userId, gp);
        }
      });

      // 4. Batch fetch all TeamGameScore records
      const allTeamGameScores = await this.teamGameScoreModel
        .find({
          userId: { $in: allMemberUserIds },
          teamId: { $in: teamIds }
        })
        .lean()
        .exec();

      // Group TeamGameScores by (teamId, userId) and get latest for each combination
      const latestTeamGameScoresMap = new Map<string, any>();
      allTeamGameScores.forEach((score: any) => {
        const userId = this.normalizeId(score.userId);
        const teamId = this.normalizeId(score.teamId);
        if (userId && teamId) {
          const key = `${teamId}:${userId}`;
          const existing = latestTeamGameScoresMap.get(key);
          if (!existing) {
            latestTeamGameScoresMap.set(key, score);
          } else {
            // Keep the latest one based on updatedAt
            const existingDate = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
            const scoreDate = score.updatedAt ? new Date(score.updatedAt).getTime() : 0;
            if (scoreDate > existingDate) {
              latestTeamGameScoresMap.set(key, score);
            }
          }
        }
      });

      // 5. Fetch org admins once (not in loop)
      const orgAdmins = await this.userModel
        .find({
          $or: [
            { organization: organizationId, userType: 'admin' },
            { userType: 'superAdmin' }
          ]
        })
        .select('_id')
        .lean()
        .exec();

      const adminUserIds = orgAdmins.map((admin) =>
        this.normalizeId(admin._id),
      ).filter((id): id is string => id !== null);

      // 6. Fetch all decks once (not in loop)
      const orgDecks = await this.deckModel
        .find({ userId: { $in: adminUserIds } })
        .select('contentIds')
        .lean()
        .exec();

      // 7. Collect all topic IDs from these decks
      const topicIdsForStats: string[] = [];
      orgDecks.forEach((deck: any) => {
        if (deck.contentIds && Array.isArray(deck.contentIds)) {
          deck.contentIds.forEach((contentId: any) => {
            const normalizedId = this.normalizeId(contentId);
            if (normalizedId && !topicIdsForStats.includes(normalizedId)) {
              topicIdsForStats.push(normalizedId);
            }
          });
        }
      });

      // 8. Batch fetch all topics once (not in loop)
      const allTopics = await this.topicModel
        .find({ _id: { $in: topicIdsForStats } })
        .lean()
        .exec();

      const topicsMap = new Map<string, any>();
      allTopics.forEach((topic: any) => {
        const topicId = this.normalizeId(topic._id);
        if (topicId) {
          topicsMap.set(topicId, topic);
        }
      });

      // OPTIMIZATION: Pre-process all accuracy arrays into Maps for O(1) lookup
      // Create Maps: key = `${topicId}:${userId}`, value = accuracy
      const flashcardAccuracyMap = new Map<string, number>();
      const battleAccuracyMap = new Map<string, number>();
      
      allTopics.forEach((topic: any) => {
        const topicId = this.normalizeId(topic._id);
        if (!topicId) return;

        // Process flashcard accuracies
        if (topic.flashcardAccuracies && Array.isArray(topic.flashcardAccuracies)) {
          topic.flashcardAccuracies.forEach((entry: any) => {
            const userId = this.normalizeId(entry.userId);
            if (userId) {
              const key = `${topicId}:${userId}`;
              flashcardAccuracyMap.set(key, entry.accuracy || 0);
            }
          });
        }

        // Process battle accuracies
        if (topic.battleAccuracies && Array.isArray(topic.battleAccuracies)) {
          topic.battleAccuracies.forEach((entry: any) => {
            const userId = this.normalizeId(entry.userId);
            if (userId) {
              const key = `${topicId}:${userId}`;
              battleAccuracyMap.set(key, entry.accuracy || 0);
            }
          });
        }
      });

      // Helper function to build subjectModeStats (now using pre-fetched Maps - O(1) lookup)
      const buildSubjectModeStats = (topicIds: string[], memberUserId: string): Record<string, any> => {
        const subjectModeStats: Record<string, any> = {};
        
        if (topicIds.length === 0) {
          return subjectModeStats;
        }

        for (const topicId of topicIds) {
          const topic = topicsMap.get(topicId);
          if (!topic) {
            subjectModeStats[topicId] = {
              flashcardAccuracy: 0,
              battleAccuracy: 0,
              Improvement: 0
            };
            continue;
          }
          
          // OPTIMIZATION: Use Map.get() instead of array.find() - O(1) vs O(n)
          const accuracyKey = `${topicId}:${memberUserId}`;
          const flashcardAccuracy = flashcardAccuracyMap.get(accuracyKey) || 0;
          const battleAccuracy = battleAccuracyMap.get(accuracyKey) || 0;

          // Calculate improvement (flashcardAccuracy/battleAccuracy * 100, handle division by zero)
          const improvement = battleAccuracy > 0 
            ? (flashcardAccuracy / battleAccuracy) * 100 
            : 0;

          subjectModeStats[topicId] = {
            flashcardAccuracy: flashcardAccuracy,
            battleAccuracy: battleAccuracy,
            Improvement: Math.round(improvement * 100) / 100 || 0
          };
        }

        return subjectModeStats;
      };

      // Step 5: Process teams with members
      const teamsData = teams.map((team: any) => {
        // Get team's total points from team table
        const teamTotalPoints = team.points || 0;
        const teamIdStr = team._id.toString();

        // Get members for this team
        const members = membersByTeam.get(teamIdStr) || [];

        // Process each member
        const membersData = members.map((member: any) => {
          if (!member.user || !member.user._id) {
            // Member without user account (pending)
            return {
              ...member,
              scores: [],
              totalPoints: teamTotalPoints, // Use team's total points
              accuracy: '0.00',
              totalGamesPlayed: 0,
              totalQuestionsAnswered: 0,
              correctAnswers: 0
            };
          }

          const memberUserId = this.normalizeId(member.user._id);
          if (!memberUserId) {
            return {
              ...member,
              scores: [],
              totalPoints: 0,
              accuracy: '0.00',
              totalGamesPlayed: 0,
              totalQuestionsAnswered: 0,
              correctAnswers: 0
            };
          }

          // Get GameProgress from map
          const gameProgress = gameProgressMap.get(memberUserId);

          // Get game stats from GameProgress
          const totalGamesPlayed = gameProgress?.totalGamesPlayed || 0;
          const totalQuestionsAnswered = gameProgress?.totalQuestions || 0;
          const correctAnswers = gameProgress?.totalCorrectAnswers || 0;

          // Get accuracy from TeamMember's gameAccuracy field
          const accuracy = member.gameAccuracy || 0;

          // Get latest TeamGameScore from map
          const scoreKey = `${teamIdStr}:${memberUserId}`;
          const latestScore = latestTeamGameScoresMap.get(scoreKey);

          // Process scores - use the latest score or create default
          let scoresData: any[] = [];
          let memberPoints = 0;
          
          if (latestScore) {
            memberPoints = latestScore.points || 0;
            
            // Build subjectModeStats using pre-fetched topics
            const subjectModeStats = buildSubjectModeStats(topicIdsForStats, memberUserId);

            scoresData = [{
              _id: latestScore._id,
              teamId: latestScore.teamId?.toString() || teamIdStr,
              userId: latestScore.userId?.toString() || memberUserId,
              points: latestScore.points || 0,
              accuracy: accuracy,
              totalGamesPlayed: totalGamesPlayed,
              totalQuestionsAnswered: totalQuestionsAnswered,
              correctAnswers: correctAnswers,
              averageResponseTime: latestScore.averageResponseTime || 0,
              subjectModeStats: subjectModeStats,
              createdAt: latestScore.createdAt || new Date(),
              updatedAt: latestScore.updatedAt || new Date(),
              __v: latestScore.__v || 0
            }];
          } else {
            // If no TeamGameScore exists, create a default one with GameProgress data
            scoresData = [{
              _id: null,
              teamId: teamIdStr,
              userId: memberUserId,
              points: 0,
              accuracy: accuracy,
              totalGamesPlayed: totalGamesPlayed,
              totalQuestionsAnswered: totalQuestionsAnswered,
              correctAnswers: correctAnswers,
              averageResponseTime: 0,
              subjectModeStats: {},
              createdAt: new Date(),
              updatedAt: new Date(),
              __v: 0
            }];
          }

          return {
            _id: member._id,
            team: member.team?.toString() || teamIdStr,
            organization: member.organization?.toString() || organizationId,
            email: member.email || member.user?.email || null,
            isAdmin: member.isAdmin || false,
            status: member.status || 'approved',
            joinedAt: member.joinedAt || new Date(),
            __v: member.__v || 0,
            user: {
              _id: member.user._id,
              name: member.user.name || null,
              email: member.user.email || null,
              profileImage: member.user.profileImage || null
            },
            scores: scoresData,
            totalPoints: memberPoints, // Member-specific points for ranking
            accuracy: accuracy.toFixed(2),
            totalGamesPlayed: totalGamesPlayed,
            totalQuestionsAnswered: totalQuestionsAnswered,
            correctAnswers: correctAnswers
          };
        });

        // Add rank per member within this team based on points (desc)
        const membersWithRank = [...membersData]
          .sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0))
          .map((member, index) => ({
            ...member,
            rank: index + 1,
          }));

        return {
          teamId: team._id.toString(),
          teamName: team.teamName,
          totalPoints: teamTotalPoints,
          memberCount: membersWithRank.length,
          members: membersWithRank
        };
      });

      return {
        message: 'Dashboard data fetched successfully',
        organizationId: organizationId,
        data: teamsData
      };
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to retrieve dashboard data',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async updateDeckName(deckId: string, userId: string, name: string) {
  if (!deckId) {
    throw new BadRequestException('Deck ID is required');
  }

  if (!userId) {
    throw new BadRequestException('User ID is required');
  }

  const trimmedName = name?.trim();
  if (!trimmedName) {
    throw new BadRequestException('Deck name is required');
  }

  const normalizedDeckId = this.normalizeId(deckId);
  const normalizedUserId = this.normalizeId(userId);

  if (!normalizedDeckId) {
    throw new BadRequestException('Invalid deck ID');
  }

  if (!normalizedUserId) {
    throw new BadRequestException('Invalid user ID');
  }

  // ✅ Get User
  const user = await this.userModel.findById(normalizedUserId);
  if (!user) {
    throw new NotFoundException('User not found');
  }

  // ✅ Get Deck
  const deck = await this.deckModel.findById(normalizedDeckId);
  if (!deck) {
    throw new NotFoundException('Deck not found');
  }

  const deckOwnerId = this.normalizeId(deck.userId);

  /**
   * ✅ Permission Logic
   * - SUPER_ADMIN → allowed
   * - ADMIN → allowed
   * - NORMAL USER → only if owner
   */
  const isAdmin =
    user.userType === 'superAdmin' ||
    user.userType === 'admin';

  const isOwner = deckOwnerId === normalizedUserId;

  if (!isAdmin && !isOwner) {
    throw new BadRequestException(
      'You are not allowed to update this deck',
    );
  }

  // ✅ Update
  deck.name = trimmedName;
  await deck.save();

  return deck.toObject();
}

  async deleteDeck(deckId: string, userId: string) {
    try {
      // Step 0: Validate inputs
      if (!deckId) {
        throw new BadRequestException('Deck ID is required');
      }

      if (!userId) {
        throw new BadRequestException('User ID is required');
      }

      const normalizedDeckId = this.normalizeId(deckId);
      const normalizedUserId = this.normalizeId(userId);

      if (!normalizedDeckId) {
        throw new BadRequestException('Invalid deck ID');
      }

      if (!normalizedUserId) {
        throw new BadRequestException('Invalid user ID');
      }

      // Step 1: Validate User
      const user = await this.userModel.findById(normalizedUserId);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Step 2: Check authorization - only superAdmin or admin can delete decks
      if (user.userType !== 'superAdmin' && user.userType !== 'admin') {
        throw new ForbiddenException('Only superAdmin or admin users can delete decks');
      }

      // Step 3: Validate Deck
      const deck = await this.deckModel.findById(normalizedDeckId);
      if (!deck) {
        throw new NotFoundException('Deck not found');
      }

      // Step 4: Get all topic IDs from deck.contentIds
      const topicIds = deck.contentIds || [];
      
      // Step 5: Get all topics and their subtopic IDs
      const topics = await this.topicModel.find({ _id: { $in: topicIds } }).exec();
      
      // Collect all subtopic IDs from all topics
      const subtopicIds: string[] = [];
      for (const topic of topics) {
        if (topic.subTopics && Array.isArray(topic.subTopics)) {
          subtopicIds.push(...topic.subTopics.map(subTopicId => subTopicId.toString()));
        }
      }

      // Step 6: Delete all subtopics
      if (subtopicIds.length > 0) {
        await this.subTopicModel.deleteMany({ _id: { $in: subtopicIds } }).exec();
      }

      // Step 7: Delete all topics
      if (topicIds.length > 0) {
        await this.topicModel.deleteMany({ _id: { $in: topicIds } }).exec();
      }

      // Step 8: Delete the deck
      await this.deckModel.findByIdAndDelete(normalizedDeckId).exec();

      return {
        statusCode: HttpStatus.OK,
        message: 'Deck, topics, and subtopics deleted successfully',
        data: {
          deletedDeck: {
            id: deck._id,
            name: deck.name
          },
          deletedTopicsCount: topics.length,
          deletedSubtopicsCount: subtopicIds.length
        }
      };
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to delete deck',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getUsersOnline(userId: string) {
    try {
      // Step 0: Validate input
      if (!isValidObjectId(userId)) {
        throw new BadRequestException('Invalid user ID');
      }

      // Step 1: Validate User (requester)
      const requester = await this.userModel.findById(userId);
      if (!requester) {
        throw new NotFoundException('User not found');
      }

      // Step 2: Check authorization - only superAdmin, admin, or member can access this API
      const allowedUserTypes = ['superAdmin', 'admin', 'member'];
      if (!allowedUserTypes.includes(requester.userType)) {
        throw new ForbiddenException('Only superAdmin, admin, or member users can access this API');
      }

      // Step 3: Query users with userType in ['superAdmin', 'admin', 'member'] and isOnline = true
      const onlineUsers = await this.userModel
        .find({
          userType: { $in: ['superAdmin', 'admin', 'member'] },
          isOnline: true
        })
        .select('name email userType isOnline profileImage organization lastSeen')
        .populate('organization', 'name logo')
        .lean()
        .exec();

      // Step 4: Get team information for each user (optimization: batch fetch team members)
      // 1. Collect all member user IDs
      const memberUserIds = onlineUsers
        .filter((user: any) => user.userType === 'member')
        .map((user: any) => this.normalizeId(user._id))
        .filter((id): id is string => id !== null && isValidObjectId(id));

      // 2. Batch fetch all team members for member users
      const allTeamMembers = await this.teamMemberModel
        .find({
          user: { $in: memberUserIds },
          status: 'approved' // Only approved members
        })
        .populate('team', 'teamName _id')
        .lean()
        .exec();

      // 3. Create a map of userId to team member (with team info)
      const teamMemberMap = new Map<string, any>();
      allTeamMembers.forEach((teamMember: any) => {
        const userId = this.normalizeId(teamMember.user);
        if (userId) {
          teamMemberMap.set(userId, teamMember);
        }
      });

      // 4. Format users with team information from the map
      const formattedUsers = onlineUsers.map((user: any) => {
        const normalizedUserId = this.normalizeId(user._id);
        const normalizedOrgId = user.organization && typeof user.organization === 'object' 
          ? this.normalizeId(user.organization._id) 
          : this.normalizeId(user.organization);

        // Initialize teamId and teamName
        let teamId: string | null = null;
        let teamName: string | null = null;

        // Only get team information for members (superAdmin and admin should have null)
        if (user.userType === 'member' && normalizedUserId) {
          const teamMember = teamMemberMap.get(normalizedUserId);
          if (teamMember && teamMember.team) {
            const team = teamMember.team as any;
            if (team && typeof team === 'object' && team._id) {
              teamId = this.normalizeId(team._id);
              teamName = team.teamName || null;
            }
          }
        }
        // For superAdmin and admin, teamId and teamName remain null

        return {
          id: normalizedUserId,
          name: user.name || null,
          email: user.email || null,
          userType: user.userType || null,
          isOnline: user.isOnline || false,
          profileImage: user.profileImage || null,
          lastSeen: user.lastSeen || null,
          teamId: teamId,
          teamName: teamName,
          organization: user.organization && typeof user.organization === 'object'
            ? {
                id: normalizedOrgId,
                name: user.organization.name || null,
                logo: user.organization.logo || null
              }
            : null
        };
      });

      return {
        statusCode: HttpStatus.OK,
        message: 'Online users retrieved successfully',
        data: {
          users: formattedUsers,
          totalOnlineUsers: formattedUsers.length
        }
      };
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to retrieve online users',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

}



