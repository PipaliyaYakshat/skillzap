import {
  Injectable,
  NotFoundException,
  BadRequestException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { User, UserDocument } from '../users/entities/user.entity';
import { Model, isValidObjectId, Types } from 'mongoose';
import {
  SubscriptionPlan,
  SubscriptionPlanDocument,
  SubscriptionType,
} from 'src/subscription/entities/subscription-plan.entity';
import {
  ContentFileData,
} from 'src/organization/entities/content-file-data.entity';
import { Deck, DeckDocument } from 'src/content/schemas/deck.schema';
import { Topic, TopicDocument } from 'src/content/schemas/topic.schema';
import { SubTopic, SubTopicDocument } from 'src/content/schemas/subtopic.schema';
import { Game, GameDocument } from 'src/content/schemas/game.schema';
import {
  GameProgress,
  GameProgressDocument,
} from 'src/content/schemas/game-progress.schema';
import { Content, ContentDocument } from 'src/content/schemas/content.schema';
import { Gamebattl, GamebattleDocument } from 'src/content/schemas/btal.game.schema';
import { UserGame, UserGameDocument } from 'src/users/entities/user-game.entity';
import {
  TeamGame,
  TeamGameDocument,
} from 'src/organization/entities/team-game.entity';
import { UpdateStatusEnterpriseDto } from '../users/dto/update-status-enterprise.dto';
import { MailService } from 'src/common/mail.service';
import * as bcrypt from 'bcrypt';
import { convertToPublicUrl } from 'src/common/multer.service';
import { ToggleUserStatusDto } from './dto/toggle-user-status.dto';
import { UpdateUserTypeDto } from './dto/update-user-type.dto';
import { DeleteDeckByIdDto } from './dto/delete-deck-by-id.dto';
import { DeleteUserDto } from './dto/delete-user.dto';
import { UpdateUserSubscriptionExpiryDto } from './dto/update-user-subscription-expiry.dto';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminForgotPasswordDto } from './dto/admin-forgot-password.dto';
import { AdminResendOtpDto } from './dto/admin-resend-otp.dto';
import { AdminVerifyOtpDto } from './dto/admin-verify-otp.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { AdminChangePasswordDto } from './dto/admin-change-password.dto';
import * as jwt from 'jsonwebtoken';
import { addMinutes } from 'date-fns';

@Injectable()
export class AdminService {
  private static readonly LIFE_REFILL_AMOUNT_INDIVIDUAL = 15;
  private static readonly LIFE_REFILL_AMOUNT_MEMBER = 50;

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(SubscriptionPlan.name)
    private readonly subscriptionPlanModel: Model<SubscriptionPlanDocument>,
    @InjectModel(ContentFileData.name)
    private readonly contentFileDataModel: Model<ContentFileData>,
    @InjectModel(Deck.name) private readonly deckModel: Model<DeckDocument>,
    @InjectModel(Topic.name) private readonly topicModel: Model<TopicDocument>,
    @InjectModel(SubTopic.name) private readonly subTopicModel: Model<SubTopicDocument>,
    @InjectModel(Game.name) private readonly gameModel: Model<GameDocument>,
    @InjectModel(GameProgress.name)
    private readonly gameProgressModel: Model<GameProgressDocument>,
    @InjectModel(Content.name) private readonly contentModel: Model<ContentDocument>,
    @InjectModel(Gamebattl.name) private readonly gamebattlModel: Model<GamebattleDocument>,
    @InjectModel(UserGame.name) private readonly userGameModel: Model<UserGameDocument>,
    @InjectModel(TeamGame.name) private readonly teamGameModel: Model<TeamGameDocument>,
    private readonly mailService: MailService,
  ) {}

  async findAll(query: { page?: number; limit?: number; search?: string; userType?: string; subscriptionType?: string; teamPlan?: string } = {}) {
    try {
      const page = query.page || 1;
      const limit = query.limit || 10;
      const skip = (page - 1) * limit;

      const filterQuery: any = { isActive: true };

      // Search by name or email (case-insensitive, partial)
      if (query.search && query.search.trim().length > 0) {
        const raw = query.search.trim();
        const esc = raw.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
        const re = new RegExp(esc, 'i');
        filterQuery.$or = [{ name: re }, { email: re }];
      }

      // Filter by userType (case-insensitive exact match)
      if (query.userType && query.userType.trim().length > 0) {
        const ut = query.userType.trim();
        filterQuery.userType = new RegExp(`^${ut.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}$`, 'i');
      }

      // Filter by subscriptionType: find plans with matching subscriptionType and filter by purchasePlanId
      if (query.subscriptionType && query.subscriptionType.trim().length > 0) {
        const subscriptionType = query.subscriptionType.trim();
        const matchingPlans = await this.subscriptionPlanModel
          .find({ subscriptionType: subscriptionType, isDeleted: false })
          .select('_id')
          .lean()
          .exec();

        if (!matchingPlans || matchingPlans.length === 0) {
          const total = 0;
          return {
            statusCode: HttpStatus.OK,
            message: 'Users received successfully.',
            data: [],
            pagination: {
              page,
              limit,
              total,
              totalPages: 0,
              hasNextPage: false,
              hasPrevPage: page > 1,
            },
          };
        }

        const planIds = matchingPlans.map((p: any) => p._id);
        filterQuery.purchasePlanId = { $in: planIds };
      }

      // Filter by teamPlan (e.g., 'enterprise')
      if (query.teamPlan && query.teamPlan.trim().length > 0) {
        filterQuery.teamPlan = query.teamPlan.trim();
      }

      const total = await this.userModel.countDocuments(filterQuery).exec();

      const users = await this.userModel
        .find(filterQuery)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec();

      const refreshedUsers = await Promise.all(
        users.map((u) => this.refreshLivesIfNeeded(u)),
      );
      const sanitizedUsers = refreshedUsers
        .filter((u): u is UserDocument => !!u)
        .map((u) => this.sanitizeUser(u));

      const totalPages = Math.ceil(total / limit);

      return {
        statusCode: HttpStatus.OK,
        message: 'Users received successfully.',
        data: sanitizedUsers,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getUsersWithPurchases(query: { page?: number; limit?: number; subscriptionType?: string } = {}) {
    try {
      const page = query.page || 1;
      const limit = query.limit || 10;
      const skip = (page - 1) * limit;

      const filterQuery: any = { purchasePlanId: { $ne: null }, isActive: true };

      // If a subscriptionType filter is provided, find plans with that subscriptionType and filter users by those plan IDs
      if (query.subscriptionType && query.subscriptionType.trim().length > 0) {
        const subscriptionType = query.subscriptionType.trim();
        const matchingPlans = await this.subscriptionPlanModel
          .find({ subscriptionType: subscriptionType, isDeleted: false })
          .select('_id')
          .lean()
          .exec();

        if (!matchingPlans || matchingPlans.length === 0) {
          const total = 0;
          return {
            statusCode: HttpStatus.OK,
            message: 'Users with purchases fetched successfully.',
            data: [],
            pagination: {
              page,
              limit,
              total,
              totalPages: 0,
              hasNextPage: false,
              hasPrevPage: page > 1,
            },
          };
        }

        const planIds = matchingPlans.map((p: any) => p._id);
        filterQuery.purchasePlanId = { $in: planIds };
      }

      const total = await this.userModel.countDocuments(filterQuery).exec();

      const users = await this.userModel
        .find(filterQuery)
        .populate({ path: 'purchasePlanId', select: 'name subscriptionType amount currency' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec();

      const sanitized = users.map((u) => {
        const base = this.sanitizeUser(u as any);
        const plan = (u.purchasePlanId as unknown) as any | null;
        const isExpired = !!(u.expirePlanDate && u.expirePlanDate.getTime() < Date.now());

        return {
          ...base,
          purchasePlan: plan
            ? {
                id: plan._id,
                name: plan.name,
                subscriptionType: plan.subscriptionType,
                amount: plan.amount,
                currency: plan.currency,
              }
            : null,
          startPlanDate: u.startPlanDate || null,
          expirePlanDate: u.expirePlanDate || null,
          isExpired,
        };
      });

      const totalPages = Math.ceil(total / limit);

      return {
        statusCode: HttpStatus.OK,
        message: 'Users with purchases fetched successfully.',
        data: sanitized,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async updateStatusEnterprise(
    updateStatusEnterpriseDto: UpdateStatusEnterpriseDto,
  ) {
    try {
      const { registrationId, status, subscriptionPlanId } =
        updateStatusEnterpriseDto;

      // Validate registration ID
      if (!isValidObjectId(registrationId)) {
        throw new BadRequestException('Invalid registration ID.');
      }

      // Find the registration
      const registration = await this.contentFileDataModel
        .findById(registrationId)
        .exec();

      if (!registration) {
        throw new NotFoundException('Registration not found.');
      }

      // If status is reject, just update the status
      if (status === 'reject') {
        registration.status = 'rejected';
        await registration.save();

        return {
          statusCode: HttpStatus.OK,
          message: 'Enterprise user registration rejected successfully.',
        };
      }

      // If status is approve, create user and send email
      if (status === 'approve') {
        // Check if user already exists with this email
        const existingUser = await this.userModel.findOne({
          email: registration.email,
        });

        if (existingUser) {
          throw new BadRequestException(
            'User with this email already exists.',
          );
        }

        // Hash password
        const defaultPassword = 'Pass@123';
        const hashedPassword = await bcrypt.hash(defaultPassword, 10);

        // Prepare user data
        const userData: any = {
          name: `${registration.firstName} ${registration.lastName}`,
          email: registration.email,
          contactNumber: registration.contactNumber,
          countryCode: registration.countryCode || '+1',
          password: hashedPassword,
          role: 'userLogin',
          userType: 'superAdmin',
          teamPlan: 'enterprise',
          isActive: true,
          isRegister: true,
        };

        // Use default subscription plan ID for yearly plan, or use provided one
        const planIdToUse = subscriptionPlanId || '694fabd16aa5ed8993a8acc1';
        
        if (!isValidObjectId(planIdToUse)) {
          throw new BadRequestException('Invalid subscription plan ID.');
        }

        const plan = await this.subscriptionPlanModel
          .findOne({ _id: planIdToUse, isDeleted: false })
          .exec();

        if (!plan) {
          throw new NotFoundException('Subscription plan not found.');
        }

        const startDate = new Date();
        const expireDate = this.calculatePlanExpiryDate(
          startDate,
          plan.subscriptionType,
        );

        userData.isPayment = true;
        userData.purchasePlanType = plan.subscriptionType;
        userData.purchasePlanId = plan._id as any;
        userData.startPlanDate = startDate;
        userData.expirePlanDate = expireDate;

        // Create the user
        const newUser = await this.userModel.create(userData);

        // Update registration status
        registration.status = 'approved';
        await registration.save();

        // Send email with credentials
        this.mailService.sendEnterpriseApprovalEmail(
          registration.email,
          registration.firstName,
          registration.lastName,
          registration.organizationName
        );

        return {
          statusCode: HttpStatus.OK,
          message: 'Enterprise user approved and account created successfully.',
          data: {
            userId: newUser._id,
            email: newUser.email,
            name: newUser.name,
            role: newUser.role,
            userType: newUser.userType,
            hasPlan: !!userData.purchasePlanId,
          },
        };
      }

      throw new BadRequestException('Invalid status value.');
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getAllUsersContentFileData(query: { page?: number; limit?: number } = {}) {
    try {
      const page = query.page || 1;
      const limit = query.limit || 10;
      const skip = (page - 1) * limit;

      // Filter by pending status
      const filterQuery = { status: 'pending' };

      const total = await this.contentFileDataModel.countDocuments(filterQuery).exec();

      const registrations = await this.contentFileDataModel
        .find(filterQuery)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec();

      const totalPages = Math.ceil(total / limit);

      return {
        statusCode: HttpStatus.OK,
        message: 'Pending enterprise registrations received successfully.',
        data: registrations,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getPublicRequests() {
    const decks = await this.deckModel
      .find({ isPublic: true, status: 'pending' })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return decks;
  }

  async approvePublicRequest(deckId: string, status: 'approve' | 'reject') {
    if (!deckId) {
      throw new BadRequestException('Deck ID is required');
    }
    if (!status) {
      throw new BadRequestException('Status is required');
    }
    if (status !== 'approve' && status !== 'reject') {
      throw new BadRequestException('Status must be either "approve" or "reject"');
    }

    const deck = await this.deckModel.findById(deckId);
    if (!deck) {
      throw new NotFoundException('Deck not found');
    }

    // Update based on status
    const updateData: any = { status };
    if (status === 'approve') {
      updateData.isPublic = true;
    } else if (status === 'reject') {
      updateData.isPublic = false;
    }

    const updated = await this.deckModel.findByIdAndUpdate(
      deckId,
      { $set: updateData },
      { new: true, lean: true },
    );

    return updated;
  }

  async toggleUserStatus(toggleUserStatusDto: ToggleUserStatusDto) {
    try {
      const { userId, isBlocked } = toggleUserStatusDto;

      if (!isValidObjectId(userId)) {
        throw new BadRequestException('Invalid user ID.');
      }

      const user = await this.userModel.findById(userId).exec();

      if (!user) {
        throw new NotFoundException('User not found.');
      }

      user.isBlocked = isBlocked;
      await user.save();

      return {
        statusCode: HttpStatus.OK,
        message: `User ${isBlocked ? 'blocked' : 'unblocked'} successfully.`,
        data: this.sanitizeUser(user),
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async updateUserType(updateUserTypeDto: UpdateUserTypeDto) {
    try {
      const { userId, userType } = updateUserTypeDto;

      if (!isValidObjectId(userId)) {
        throw new BadRequestException('Invalid user ID.');
      }

      const user = await this.userModel.findById(userId).exec();

      if (!user) {
        throw new NotFoundException('User not found.');
      }

      user.userType = userType;
      await user.save();

      return {
        statusCode: HttpStatus.OK,
        message: 'User type updated successfully.',
        data: this.sanitizeUser(user),
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getContentFileData(query: { page?: number; limit?: number; status?: 'approved' | 'pending' } = {}) {
    try {
      const page = query.page || 1;
      const limit = query.limit || 10;
      const skip = (page - 1) * limit;

      const filterQuery: any = {};

      // Filter by status if provided
      if (query.status && (query.status === 'approved' || query.status === 'pending')) {
        filterQuery.status = query.status;
      }

      const total = await this.contentFileDataModel.countDocuments(filterQuery).exec();

      const contentFileData = await this.contentFileDataModel
        .find(filterQuery)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec();

      const totalPages = Math.ceil(total / limit);

      return {
        statusCode: HttpStatus.OK,
        message: 'Content file data retrieved successfully.',
        data: contentFileData,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getPublicApprovedDecks(query: { page?: number; limit?: number; search?: string } = {}) {
    try {
      const page = query.page || 1;
      const limit = query.limit || 10;
      const skip = (page - 1) * limit;

      const filterQuery: any = {
        isPublic: true,
        status: 'approve',
      };

      // Search by deck name (case-insensitive, partial)
      if (query.search && query.search.trim().length > 0) {
        const raw = query.search.trim();
        const esc = raw.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
        const re = new RegExp(esc, 'i');
        filterQuery.name = re;
      }

      const total = await this.deckModel.countDocuments(filterQuery).exec();

      const decks = await this.deckModel
        .find(filterQuery)
        .populate({ path: 'userId', select: 'name email' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec();

      const totalPages = Math.ceil(total / limit);

      return {
        statusCode: HttpStatus.OK,
        message: 'Public approved decks retrieved successfully.',
        data: decks,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async deleteDeckById(deleteDeckByIdDto: DeleteDeckByIdDto) {
    try {
      const { deckId } = deleteDeckByIdDto;

      if (!isValidObjectId(deckId)) {
        throw new BadRequestException('Invalid deck ID.');
      }

      // Find the deck
      const deck = await this.deckModel.findById(deckId).exec();

      if (!deck) {
        throw new NotFoundException('Deck not found.');
      }

      // Get all topic IDs from deck.contentIds
      const topicIds = deck.contentIds || [];

      // Find all topics and get their subtopic IDs
      const topics = await this.topicModel
        .find({ _id: { $in: topicIds } })
        .exec();

      const subTopicIds: string[] = [];
      for (const topic of topics) {
        if (topic.subTopics && topic.subTopics.length > 0) {
          subTopicIds.push(...topic.subTopics);
        }
      }

      // Delete all subtopics
      if (subTopicIds.length > 0) {
        await this.subTopicModel.deleteMany({ _id: { $in: subTopicIds } }).exec();
      }

      // Delete all topics
      if (topicIds.length > 0) {
        await this.topicModel.deleteMany({ _id: { $in: topicIds } }).exec();
      }

      // Delete the deck
      await this.deckModel.findByIdAndDelete(deckId).exec();

      return {
        statusCode: HttpStatus.OK,
        message: 'Deck and all related content (topics and subtopics) deleted successfully.',
        data: {
          deckId,
          deletedTopics: topicIds.length,
          deletedSubTopics: subTopicIds.length,
        },
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async deleteUser(deleteUserDto: DeleteUserDto) {
    try {
      const { userId } = deleteUserDto;

      if (!isValidObjectId(userId)) {
        throw new BadRequestException('Invalid user ID.');
      }

      // Find the user
      const user = await this.userModel.findById(userId).exec();

      if (!user) {
        throw new NotFoundException('User not found.');
      }

      // Find all decks owned by this user
      const userDecks = await this.deckModel
        .find({ userId: userId })
        .exec();

      const deckIds = userDecks.map((deck) => deck._id.toString());
      const topicIds: string[] = [];
      const subTopicIds: string[] = [];

      // Get all topics and subtopics from user's decks
      for (const deck of userDecks) {
        if (deck.contentIds && deck.contentIds.length > 0) {
          topicIds.push(...deck.contentIds);
        }
      }

      if (topicIds.length > 0) {
        const topics = await this.topicModel
          .find({ _id: { $in: topicIds } })
          .exec();

        for (const topic of topics) {
          if (topic.subTopics && topic.subTopics.length > 0) {
            subTopicIds.push(...topic.subTopics);
          }
        }
      }

      // Delete all subtopics
      if (subTopicIds.length > 0) {
        await this.subTopicModel.deleteMany({ _id: { $in: subTopicIds } }).exec();
      }

      // Delete all topics
      if (topicIds.length > 0) {
        await this.topicModel.deleteMany({ _id: { $in: topicIds } }).exec();
      }

      // Delete all decks
      if (deckIds.length > 0) {
        await this.deckModel.deleteMany({ _id: { $in: deckIds } }).exec();
      }

      // Delete all games where user is in players array
      await this.gameModel.deleteMany({ players: { $in: [userId] } }).exec();

      // Delete all game progress
      await this.gameProgressModel.deleteMany({ userId: userId }).exec();

      // Delete all user games
      await this.userGameModel.deleteMany({ userId: userId }).exec();

      // Delete all battle games where user is host or in invited/accepted arrays
      await this.gamebattlModel.deleteMany({
        $or: [
          { hostUserId: userId },
          { invitedUserIds: { $in: [userId] } },
          { acceptedUserIds: { $in: [userId] } },
        ],
      }).exec();

      // Delete all team games where user is creator or in invited/accepted arrays
      // Note: creator, invitedParticipants, and acceptedParticipants are ObjectId
      const userIdObjectId = new Types.ObjectId(userId);
      await this.teamGameModel.deleteMany({
        $or: [
          { creator: userIdObjectId },
          { invitedParticipants: { $in: [userIdObjectId] } },
          { acceptedParticipants: { $in: [userIdObjectId] } },
        ],
      }).exec();

      // Delete all content
      await this.contentModel.deleteMany({ userId: userId }).exec();

      // Finally, delete the user
      await this.userModel.findByIdAndDelete(userId).exec();

      return {
        statusCode: HttpStatus.OK,
        message: 'User and all related data deleted successfully.',
        data: {
          userId,
          deletedDecks: deckIds.length,
          deletedTopics: topicIds.length,
          deletedSubTopics: subTopicIds.length,
        },
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async updateUserSubscriptionExpiry(
    updateUserSubscriptionExpiryDto: UpdateUserSubscriptionExpiryDto,
  ) {
    try {
      const { userId, expiryDate } = updateUserSubscriptionExpiryDto;

      if (!isValidObjectId(userId)) {
        throw new BadRequestException('Invalid user ID.');
      }

      // Validate expiry date
      const expiry = new Date(expiryDate);
      if (isNaN(expiry.getTime())) {
        throw new BadRequestException('Invalid expiry date format.');
      }

      // Find the user
      const user = await this.userModel.findById(userId).exec();

      if (!user) {
        throw new NotFoundException('User not found.');
      }

      // Update the expiry date
      user.expirePlanDate = expiry;
      await user.save();

      return {
        statusCode: HttpStatus.OK,
        message: 'User subscription expiry date updated successfully.',
        data: {
          userId,
          expirePlanDate: user.expirePlanDate,
        },
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getDeckByIdWithDetails(deckId: string) {
    try {
      if (!isValidObjectId(deckId)) {
        throw new BadRequestException('Invalid deck ID.');
      }

      // Find the deck
      const deck = await this.deckModel.findById(deckId)
        .populate({ path: 'userId', select: 'name email' })
        .lean()
        .exec();

      if (!deck) {
        throw new NotFoundException('Deck not found.');
      }

      // Get all topics from deck's contentIds
      const topicIds = (deck.contentIds || []).filter((id) => isValidObjectId(id));

      if (topicIds.length === 0) {
        return {
          statusCode: HttpStatus.OK,
          message: 'Deck retrieved successfully.',
          data: {
            ...deck,
            topics: [],
          },
        };
      }

      // Get all topics
      const topics = await this.topicModel
        .find({ _id: { $in: topicIds } })
        .lean()
        .exec();

      // For each topic, get all subtopics
      const topicsWithSubtopics = await Promise.all(
        topics.map(async (topic) => {
          const subTopicIds = (topic.subTopics || []).filter((id) => isValidObjectId(id));

          let subtopics: any[] = [];
          if (subTopicIds.length > 0) {
            subtopics = await this.subTopicModel
              .find({ _id: { $in: subTopicIds } })
              .lean()
              .exec();
          }

          return {
            ...topic,
            subTopics: subtopics,
          };
        }),
      );

      return {
        statusCode: HttpStatus.OK,
        message: 'Deck retrieved successfully with all topics and subtopics.',
        data: {
          ...deck,
          topics: topicsWithSubtopics,
        },
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Helper methods
  private sanitizeUser(user: UserDocument) {
    const {
      password,
      otp,
      otpSendDate,
      verifyOtp,
      forgotPassword,
      __v,
      ...rest
    } = user.toObject();
    
    // Convert profileImage filesystem path to public URL if needed
    // Only convert if it looks like a file path, not if it's just an avatarId
    if (rest.profileImage) {
      // If profileImage contains a path separator or starts with /, it's a file path
      // Otherwise, it's likely an avatarId and should be returned as is
      if (rest.profileImage.includes('/') || rest.profileImage.startsWith('/')) {
        rest.profileImage = convertToPublicUrl(rest.profileImage);
      }
      // If it's just a simple string (avatarId), keep it as is
    }
    
    return rest;
  }

  private async refreshLivesIfNeeded(
    user: UserDocument | null,
    ): Promise<UserDocument | null> {
    if (!user) {
      return null;
    }

    const now = Date.now();
    const refillDue =
      user.nextLivesRefillAt &&
      user.nextLivesRefillAt.getTime() <= now &&
      user.lives <= 0;

    if (refillDue) {
      // Give different lives based on userType
      // "member" -> 50 lives
      // "individual"/"Individual" or any other type -> 15 lives
      const isMember = user.userType?.toLowerCase() === 'member';
      const refillAmount = isMember 
        ? AdminService.LIFE_REFILL_AMOUNT_MEMBER 
        : AdminService.LIFE_REFILL_AMOUNT_INDIVIDUAL;
      
      user.lives = refillAmount;
      user.nextLivesRefillAt = null;
      return user.save();
    }

    if (user.lives > 0 && user.nextLivesRefillAt) {
      user.nextLivesRefillAt = null;
      return user.save();
    }

    return user;
  }

  private calculatePlanExpiryDate(
    startDate: Date,
    subscriptionType: SubscriptionType,
  ) {
    const expiryDate = new Date(startDate);

    switch (subscriptionType) {
      case SubscriptionType.YEAR:
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);
        break;
      case SubscriptionType.MONTH:
        expiryDate.setMonth(expiryDate.getMonth() + 1);
        break;
      case SubscriptionType.FOURTEEN_DAY:
        expiryDate.setDate(expiryDate.getDate() + 14);
        break;
      default:
        expiryDate.setMonth(expiryDate.getMonth() + 1);
        break;
    }
    return expiryDate;
  }

  // Admin Authentication Methods
  async adminLogin(adminLoginDto: AdminLoginDto) {
    try {
      const { email, password } = adminLoginDto;

      const admin = await this.userModel.findOne({ 
        email,
        role: { $in: ['admin'] }
      });

      if (!admin) {
        throw new BadRequestException('Admin not found.');
      }

      if (admin.isBlocked) {
        throw new BadRequestException('Admin account is blocked.');
      }

      const isMatch = await bcrypt.compare(password, admin.password);
      if (!isMatch) {
        throw new BadRequestException('Password does not match.');
      }

      const token = this.generateJwtToken(admin);
      
      admin.isOnline = true;
      admin.isActive = true;
      await admin.save();

      return {
        statusCode: HttpStatus.OK,
        message: 'Admin login successful!',
        data: { user: this.sanitizeUser(admin), token },
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async adminForgotPassword(adminForgotPasswordDto: AdminForgotPasswordDto) {
    try {
      const admin = await this.userModel.findOne({
        email: adminForgotPasswordDto.email,
        role: { $in: ['admin'] }
      });

      if (!admin) {
        throw new NotFoundException('Admin not found.');
      }

      const otp = Math.floor(100000 + Math.random() * 900000);
      const otpExpires = this.getOtpExpiryDate();

      admin.otp = otp;
      admin.otpSendDate = otpExpires;
      admin.forgotPassword = true;
      admin.verifyOtp = false;
      await admin.save();

      this.mailService.sendOtpEmail(admin.email, admin.name || admin.email || 'Admin', otp);

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

  async adminResendOtp(adminResendOtpDto: AdminResendOtpDto) {
    try {
      const admin = await this.userModel.findOne({ 
        email: adminResendOtpDto.email,
        role: { $in: ['admin'] }
      });

      if (!admin) {
        throw new NotFoundException('Admin not found.');
      }

      if (!admin.otp || !admin.otpSendDate || !admin.forgotPassword) {
        throw new BadRequestException(
          'No active password reset request found.',
        );
      }

      if (admin.otpSendDate > new Date()) {
        const minutesLeft = Math.ceil(
          (admin.otpSendDate.getTime() - new Date().getTime()) / 60000,
        );
        throw new BadRequestException(
          `OTP is still valid. Try again in ${minutesLeft} minute(s).`,
        );
      }

      const otp = Math.floor(100000 + Math.random() * 900000);
      const otpExpires = this.getOtpExpiryDate();

      admin.otp = otp;
      admin.otpSendDate = otpExpires;
      admin.verifyOtp = false;
      await admin.save();

      this.mailService.sendOtpEmail(admin.email, admin.name || admin.email || 'Admin', otp);

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

  async adminVerifyOtp(adminVerifyOtpDto: AdminVerifyOtpDto) {
    try {
      const admin = await this.userModel.findOne({ 
        email: adminVerifyOtpDto.email,
        role: { $in: ['admin'] }
      });

      if (!admin) {
        throw new NotFoundException('Admin not found.');
      }

      if (!admin.forgotPassword) {
        throw new BadRequestException(
          'No active OTP request found. Please request an OTP first.',
        );
      }

      if (!admin.otpSendDate || admin.otpSendDate <= new Date()) {
        throw new BadRequestException('OTP expired. Please request a new one.');
      }

      if (admin.otp !== Number(adminVerifyOtpDto.otp)) {
        throw new BadRequestException('Invalid OTP.');
      }

      admin.verifyOtp = true;
      await admin.save();

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

  async adminResetPassword(adminResetPasswordDto: AdminResetPasswordDto) {
    try {
      if (adminResetPasswordDto.password !== adminResetPasswordDto.confirmPassword) {
        throw new BadRequestException('Passwords must match.');
      }

      const admin = await this.userModel.findOne({
        email: adminResetPasswordDto.email,
        role: { $in: ['admin'] }
      });

      if (!admin) {
        throw new BadRequestException('Invalid password reset request.');
      }

      if (!admin.forgotPassword) {
        throw new BadRequestException(
          'Please initiate the forgot password process first.',
        );
      }

      if (!admin.verifyOtp) {
        throw new BadRequestException('OTP verification required.');
      }

      const hashedPassword = await bcrypt.hash(adminResetPasswordDto.password, 10);

      admin.password = hashedPassword;
      admin.otp = null;
      admin.otpSendDate = null;
      admin.forgotPassword = false;
      admin.verifyOtp = false;

      await admin.save();

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

  // Helper methods for authentication
  private generateJwtToken(user: any): string {
    return jwt.sign({ id: user._id, role: user.role }, 'TOKEN');
  }

  private getOtpExpiryDate(): Date {
    return addMinutes(new Date(), 2);
  }

  async changePassword(adminId: string, adminChangePasswordDto: AdminChangePasswordDto) {
    try {
      const { oldPassword, newPassword } = adminChangePasswordDto;

      const admin = await this.userModel.findOne({
        _id: adminId,
        role: { $in: ['admin'] }
      });

      if (!admin) {
        throw new NotFoundException('Admin not found.');
      }

      if (admin.isBlocked) {
        throw new BadRequestException('Admin account is blocked.');
      }

      // Verify old password
      const isOldPasswordValid = await bcrypt.compare(
        oldPassword,
        admin.password,
      );

      if (!isOldPasswordValid) {
        throw new BadRequestException('Old password is incorrect.');
      }

      // Hash new password
      const hashedNewPassword = await bcrypt.hash(newPassword, 10);

      // Update password
      admin.password = hashedNewPassword;
      await admin.save();

      return {
        statusCode: HttpStatus.OK,
        message: 'Password changed successfully.',
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
