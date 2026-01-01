import {
  Injectable,
  NotFoundException,
  BadRequestException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { User, UserDocument } from './entities/user.entity';
import { Model, isValidObjectId } from 'mongoose';
import type { UpdateUserDto } from './dto/update-user.dto';
import * as fs from 'fs';
import * as bcrypt from 'bcrypt';
import {
  SubscriptionPlan,
  SubscriptionPlanDocument,
  SubscriptionType,
} from 'src/subscription/entities/subscription-plan.entity';
import {
  GameProgress,
  GameProgressDocument,
} from 'src/content/schemas/game-progress.schema';
import { Deck, DeckDocument } from 'src/content/schemas/deck.schema';
import {
  Organization,
  OrganizationDocument,
} from 'src/organization/entities/orgenaztion.entity';
import { BuyPlanDto } from './dto/buy-plan.dto';
import { PurchaseLiveDto } from './dto/purchase-live.dto';
import { PurchaseCoinDto } from './dto/purchase-coin.dto';
import { PurchaseAvatarDto } from './dto/purchase-avatar.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ContentFileData } from 'src/organization/entities/content-file-data.entity';
import { MailService } from 'src/common/mail.service';
import { convertToPublicUrl, getPublicUrlPath } from 'src/common/multer.service';
import { ContentService } from 'src/content/content.service';

@Injectable()
export class UsersService {
  private static readonly LIFE_REFILL_DELAY_MS = 5 * 60 * 1000;
  private static readonly LIFE_REFILL_AMOUNT_INDIVIDUAL = 15;
  private static readonly LIFE_REFILL_AMOUNT_MEMBER = 50;

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(SubscriptionPlan.name)
    private readonly subscriptionPlanModel: Model<SubscriptionPlanDocument>,
    @InjectModel(ContentFileData.name)
    private readonly contentFileDataModel: Model<ContentFileData>,
    @InjectModel(GameProgress.name)
    private readonly gameProgressModel: Model<GameProgressDocument>,
    @InjectModel(Deck.name) private readonly deckModel: Model<DeckDocument>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationDocument>,
    private readonly mailService: MailService,
    @Inject(forwardRef(() => ContentService))
    private readonly contentService: ContentService,
  ) {}

  async findOne(userId: string) {
    try {
      const userDoc = await this.refreshLivesIfNeeded(
        this.assertActiveUser(
          await this.userModel
            .findById(userId)
            .populate('organization', 'name logo')
            .exec(),
        ),
      );

      if (!userDoc) {
        throw new NotFoundException('User not found.');
      }

      const [dailyStreak, createdDecks, gameProgress] = await Promise.all([
        this.contentService.getDailyStreak(userId),
        this.deckModel
          .find({ userId })
          .sort({ createdAt: -1 })
          .lean()
          .exec(),
        this.gameProgressModel.findOne({ userId }).lean().exec(),
      ]);

      const userPoints = gameProgress?.points || 0;
      const badges = this.calculateBadges(userPoints);

      // Get organization info if user belongs to one
      let organizerName = userDoc.organizerName || null;
      let organizerLogo = userDoc.organizerLogo || null;
      let organizationId = userDoc.organization ? (userDoc.organization as any)?.toString() || userDoc.organization : null;

      if (userDoc.organization) {
        const organization = userDoc.organization as unknown as OrganizationDocument;
        if (organization) {
          organizerName = organization.name || null;
          organizerLogo = organization.logo || null;
          organizationId = (organization as any)._id?.toString() || organizationId;
        }
      } else {
        // If user's organization field is null, check if user is a creator of an organization
        const createdOrganization = await this.organizationModel
          .findOne({ creatorId: userId })
          .lean()
          .exec();
        
        if (createdOrganization) {
          organizerName = createdOrganization.name || null;
          organizerLogo = createdOrganization.logo || null;
          organizationId = createdOrganization._id?.toString() || null;
        }
      }

      // Convert organizerLogo to public URL if needed
      if (organizerLogo) {
        organizerLogo = convertToPublicUrl(organizerLogo);
      }

      const sanitizedUser = this.sanitizeUser(userDoc);

      return {
        statusCode: HttpStatus.OK,
        message: 'User information received successfully.',
        data: {
          ...sanitizedUser,
          organizerName,
          organizerLogo,
          organization: organizationId,
          dailyStreak,
          createdDecks,
          points: userPoints,
          badges,
        },
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async updateUser(
    userId: string,
    updateUserDto: UpdateUserDto,
    profileImage?: Express.Multer.File,
  ) {
    try {
      let user = this.assertActiveUser(
        await this.userModel.findById(userId).exec(),
      );

      const refreshedUser = await this.refreshLivesIfNeeded(user);
      if (!refreshedUser) {
        throw new NotFoundException('User not found.');
      }
      user = refreshedUser;

      if (updateUserDto.name) user.name = updateUserDto.name;
      if (updateUserDto.email) {
        const existingUserByEmail = await this.userModel.findOne({
          email: updateUserDto.email,
          _id: { $ne: userId },
        });

        if (existingUserByEmail) {
          throw new BadRequestException('This email is already registered.');
        }

        user.email = updateUserDto.email;
      }
      if (updateUserDto.profileImage) {
        user.profileImage = updateUserDto.profileImage;
      }
      if (updateUserDto.avatarId !== undefined) {
        const existingAvatarIds = Array.isArray(user.avatarId)
          ? user.avatarId
          : user.avatarId !== undefined && user.avatarId !== null
            ? [user.avatarId as any]
            : [];

        const incomingAvatarIds = Array.isArray(updateUserDto.avatarId)
          ? updateUserDto.avatarId
          : [updateUserDto.avatarId];

        const mergedAvatarIds = [
          ...existingAvatarIds,
          ...incomingAvatarIds,
        ].filter((id) => id !== '' && id !== undefined && id !== null);

        user.avatarId = Array.from(new Set(mergedAvatarIds)) as any;
        
        // Update profileImage to avatarId value when avatarId is set
        // Use the newly added avatarId (last one from incoming) for profileImage
        const validIncomingIds = incomingAvatarIds.filter((id) => id !== '' && id !== undefined && id !== null);
        if (validIncomingIds.length > 0) {
          // Use the last incoming avatar ID (most recently added) for profileImage
          const newAvatarId = validIncomingIds[validIncomingIds.length - 1];
          user.profileImage = newAvatarId;
        } else if (user.avatarId && user.avatarId.length > 0) {
          // Fallback: if no valid incoming IDs, use the last one from merged array
          const lastAvatarId = user.avatarId[user.avatarId.length - 1];
          user.profileImage = lastAvatarId;
        }
      }
      if (updateUserDto.purchasedAvatars !== undefined) {
        const existingPurchasedAvatars = Array.isArray(user.purchasedAvatars)
          ? user.purchasedAvatars
          : user.purchasedAvatars !== undefined && user.purchasedAvatars !== null
            ? [user.purchasedAvatars as any]
            : [];

        const incomingPurchasedAvatars = Array.isArray(updateUserDto.purchasedAvatars)
          ? updateUserDto.purchasedAvatars
          : [updateUserDto.purchasedAvatars];

        const mergedPurchasedAvatars = [
          ...existingPurchasedAvatars,
          ...incomingPurchasedAvatars,
        ].filter((id) => id !== '' && id !== undefined && id !== null);

        user.purchasedAvatars = Array.from(new Set(mergedPurchasedAvatars)) as any;
      }

      if (profileImage) {
        user.profileImage = getPublicUrlPath('profile-images', profileImage.filename);
      }

      const updatedUser = await user.save();

      return {
        statusCode: HttpStatus.OK,
        message: 'User updated successfully.',
        data: this.sanitizeUser(updatedUser),
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async remove(userId: string) {
    try {
      const user = await this.refreshLivesIfNeeded(
        this.assertActiveUser(await this.userModel.findById(userId).exec()),
      );

      if (!user) {
        throw new NotFoundException('User not found.');
      }

      user.isActive = false;

      const updatedUser = await user.save();

      return {
        statusCode: HttpStatus.OK,
        message: 'User soft deleted successfully.',
        data: this.sanitizeUser(updatedUser),
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async logout(userId: string) {
    try {
      const user = this.assertActiveUser(
        await this.userModel.findById(userId).exec(),
      );

      user.isOnline = false;
      user.isActive = false;

      const updatedUser = await user.save();

      return {
        statusCode: HttpStatus.OK,
        message: 'User logged out successfully.',
        data: this.sanitizeUser(updatedUser),
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findById(userId: string) {
    if (!isValidObjectId(userId)) {
      throw new BadRequestException('Invalid user id.');
    }

    const user = await this.userModel.findById(userId).exec();
    return this.refreshLivesIfNeeded(user);
  }

  async updateUserSocketInfo(userId: string, update: Record<string, any>) {
    if (!isValidObjectId(userId)) {
      throw new BadRequestException('Invalid user id.');
    }

    return this.userModel.findByIdAndUpdate(userId, update, {
      new: true,
      runValidators: false,
    });
  }

  async decrementLife(userId: string, amount = 1) {
    if (!isValidObjectId(userId)) {
      throw new BadRequestException('Invalid user id.');
    }

    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const currentLives = Number.isFinite(user.lives) ? user.lives : 0;
    user.lives = Math.max(0, currentLives - amount);
    if (user.lives === 0) {
      user.nextLivesRefillAt = new Date(
        Date.now() + UsersService.LIFE_REFILL_DELAY_MS,
      );
    } else if (user.nextLivesRefillAt) {
      user.nextLivesRefillAt = null;
    }

    return user.save();
  }

  private assertActiveUser(user: UserDocument | null): UserDocument {
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('User is not active.');
    }
    return user;
  }

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
        ? UsersService.LIFE_REFILL_AMOUNT_MEMBER 
        : UsersService.LIFE_REFILL_AMOUNT_INDIVIDUAL;
      
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

  private getDateString(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getStartOfWeek(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0 (Sun) - 6 (Sat)
    const diff = (day + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - diff);
    return d;
  }

  private buildWeeklyIcons(
    dailyGamesCount: Record<string, number>,
  ): string[] {
    const icons: string[] = [];
    const today = new Date();
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const todayDateString = this.getDateString(today);
    const startOfWeek = this.getStartOfWeek(today); // Monday

    // Monday -> Sunday
    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + i);
      const dateString = this.getDateString(date);
      const gamesCount = dailyGamesCount[dateString] || 0;
      const isToday = dateString === todayDateString;
      const isFuture = date > todayStart;

      if (gamesCount === 0) {
        icons.push(isToday || isFuture ? '' : 'cross');
      } else if (gamesCount === 1) {
        icons.push('true');
      } else {
        icons.push('fire');
      }
    }

    return icons;
  }

  private buildWeeklyIconMeta(
    startOfWeek: Date,
    icons: string[],
  ): { day: string; date: string; icon: string }[] {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return icons.map((icon, idx) => {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + idx);
      return {
        day: days[idx],
        date: this.getDateString(date),
        icon,
      };
    });
  }

  /**
   * Calculate badges based on points using cycling logic (same as content.service.ts)
   * Badges cycle every 100 points:
   * 1-20: Spark
   * 21-40: Momentum (also unlocks Spark)
   * 41-60: Breakthrough (also unlocks Spark, Momentum)
   * 61-80: Pioneer (also unlocks Spark, Momentum, Breakthrough)
   * 81-100: Mastery (unlocks all badges)
   */
  private calculateBadges(userPoints: number) {
    const badgeOrder = [
      { id: 1, name: 'Spark' },
      { id: 2, name: 'Momentum' },
      { id: 3, name: 'Breakthrough' },
      { id: 4, name: 'Pioneer' },
      { id: 5, name: 'Mastery' },
    ];

    if (userPoints === 0) {
      return badgeOrder.map((badge) => ({
        id: badge.id,
        name: badge.name,
        isUnlocked: false,
      }));
    }

    // Handle special case: when points is exactly 100, 200, etc., all badges are unlocked
    if (userPoints > 0 && userPoints % 100 === 0) {
      return badgeOrder.map((badge) => ({
        id: badge.id,
        name: badge.name,
        isUnlocked: true,
      }));
    }

    // Calculate points within the current 100-point cycle
    const pointsInCycle = userPoints % 100;
    
    let unlockedBadgesCount = 0;
    
    if (pointsInCycle >= 1 && pointsInCycle <= 20) {
      unlockedBadgesCount = 1; // Spark
    } else if (pointsInCycle >= 21 && pointsInCycle <= 40) {
      unlockedBadgesCount = 2; // Spark, Momentum
    } else if (pointsInCycle >= 41 && pointsInCycle <= 60) {
      unlockedBadgesCount = 3; // Spark, Momentum, Breakthrough
    } else if (pointsInCycle >= 61 && pointsInCycle <= 80) {
      unlockedBadgesCount = 4; // Spark, Momentum, Breakthrough, Pioneer
    } else if (pointsInCycle >= 81 && pointsInCycle <= 99) {
      unlockedBadgesCount = 5; // All badges
    }

    return badgeOrder.map((badge, index) => ({
      id: badge.id,
      name: badge.name,
      isUnlocked: index < unlockedBadgesCount,
    }));
  }

  private async getDailyStreak(userId: string) {
    if (!isValidObjectId(userId)) {
      return null;
    }

    const progress = await this.gameProgressModel
      .findOne({ userId })
      .lean()
      .exec();

    if (!progress) {
      const today = new Date();
      const todayStart = new Date(today);
      todayStart.setHours(0, 0, 0, 0);
      const startOfWeek = this.getStartOfWeek(today);
      const todayDateString = this.getDateString(today);
      const defaultIcons: string[] = [];
      for (let i = 0; i < 7; i++) {
        const date = new Date(startOfWeek);
        date.setDate(startOfWeek.getDate() + i);
        const dateString = this.getDateString(date);
        const isToday = dateString === todayDateString;
        const isFuture = date > todayStart;
        defaultIcons.push(isToday || isFuture ? '' : 'cross');
      }
      const dailyStreakWeek = this.buildWeeklyIconMeta(startOfWeek, defaultIcons);

      return {
        currentDailyStreak: 0,
        longestDailyStreak: 0,
        dailyStreakIcons: defaultIcons,
        dailyStreakWeek,
        lastGamePlayDate: null,
      };
    }

    const dailyGamesCount = progress.dailyGamesCount || {};
    const startOfWeek = this.getStartOfWeek(new Date());
    let dailyStreakIcons = this.buildWeeklyIcons(dailyGamesCount);
    let dailyStreakWeek = this.buildWeeklyIconMeta(startOfWeek, dailyStreakIcons);

    // ensure 7 length fallback
    if (dailyStreakIcons.length !== 7) {
      const today = new Date();
      const todayStart = new Date(today);
      todayStart.setHours(0, 0, 0, 0);
      const todayDateString = this.getDateString(today);
      dailyStreakIcons = [];
      for (let i = 0; i < 7; i++) {
        const date = new Date(startOfWeek);
        date.setDate(startOfWeek.getDate() + i);
        const dateString = this.getDateString(date);
        const gamesCount = dailyGamesCount[dateString] || 0;
        const isToday = dateString === todayDateString;
        const isFuture = date > todayStart;
        if (gamesCount === 0) {
          dailyStreakIcons.push(isToday || isFuture ? '' : 'cross');
        } else if (gamesCount === 1) {
          dailyStreakIcons.push('true');
        } else {
          dailyStreakIcons.push('fire');
        }
      }
      dailyStreakWeek = this.buildWeeklyIconMeta(startOfWeek, dailyStreakIcons);
    }

    return {
      currentDailyStreak: progress.currentDailyStreak || 0,
      longestDailyStreak: progress.longestDailyStreak || 0,
      dailyStreakIcons,
      dailyStreakWeek,
      lastGamePlayDate: progress.lastGamePlayDate || null,
    };
  }


  async buySubscriptionPlan(userId: string, buyPlanDto: BuyPlanDto) {
    try {
      const { subscriptionPlanId, cardNumber } = buyPlanDto;

      if (!isValidObjectId(subscriptionPlanId)) {
        throw new BadRequestException('Invalid subscription plan ID.');
      }

      const user = this.assertActiveUser(
        await this.userModel.findById(userId).exec(),
      );

      const plan = await this.subscriptionPlanModel
        .findOne({ _id: subscriptionPlanId, isDeleted: false })
        .exec();

      if (!plan) {
        throw new NotFoundException('Subscription plan not found.');
      }

      const hasActivePlan =
        !!user.purchasePlanId &&
        !!user.expirePlanDate &&
        user.expirePlanDate.getTime() > Date.now();

      if (hasActivePlan) {
        throw new BadRequestException(
          'You already have an active plan. Please wait until it expires.',
        );
      }

      const startDate = new Date();
      const expireDate = this.calculatePlanExpiryDate(
        startDate,
        plan.subscriptionType,
      );

      user.isPayment = true;
      user.purchasePlanType = plan.subscriptionType;
      user.purchasePlanId = plan._id as any;
      user.startPlanDate = startDate;
      user.expirePlanDate = expireDate;
      user.cardNumber = cardNumber;
      user.userType = 'superAdmin';

      await user.save();

      return {
        statusCode: HttpStatus.OK,
        message: 'Subscription plan purchased successfully.',
        data: {
          plan: {
            id: plan._id,
            name: plan.name,
            subscriptionType: plan.subscriptionType,
            amount: plan.amount,
            currency: plan.currency,
          },
          startPlanDate: startDate,
          expirePlanDate: expireDate,
        },
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getMyPlan(userId: string) {
    try {
      const user = this.assertActiveUser(
        await this.userModel
          .findById(userId)
          .populate({
            path: 'purchasePlanId',
            select: 'name subscriptionType amount currency',
          })
          .exec(),
      );

      if (!user.purchasePlanId) {
        return {
          statusCode: HttpStatus.OK,
          message: 'No subscription plan found for this user.',
          data: null,
        };
      }

      const plan =
        user.purchasePlanId as unknown as SubscriptionPlanDocument | null;

      const isExpired = !!(
        user.expirePlanDate && user.expirePlanDate.getTime() < Date.now()
      );

      return {
        statusCode: HttpStatus.OK,
        message: 'Subscription plan fetched successfully.',
        data: {
          plan: plan
            ? {
                id: plan._id,
                name: plan.name,
                subscriptionType: plan.subscriptionType,
                amount: plan.amount,
                currency: plan.currency,
              }
            : null,
          startPlanDate: user.startPlanDate,
          expirePlanDate: user.expirePlanDate,
          isExpired,
          cardNumber: user.cardNumber,
        },
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async purchaseLive(userId: string, purchaseLiveDto: PurchaseLiveDto) {
    try {
      const { subscriptionPlanId, cardNumber } = purchaseLiveDto;

      if (!isValidObjectId(subscriptionPlanId)) {
        throw new BadRequestException('Invalid subscription plan ID.');
      }

      const user = this.assertActiveUser(
        await this.userModel.findById(userId).exec(),
      );

      const plan = await this.subscriptionPlanModel
        .findOne({ _id: subscriptionPlanId, isDeleted: false })
        .exec();

      if (!plan) {
        throw new NotFoundException('Subscription plan not found.');
      }

      if (plan.subscriptionType !== SubscriptionType.LIVES) {
        throw new BadRequestException(
          'This subscription plan is not for purchasing lives.',
        );
      }

      // Parse the number of lives from the plan name (e.g., "5", "10", "25")
      const livesToAdd = parseInt(plan.name, 10);
      if (isNaN(livesToAdd) || livesToAdd <= 0) {
        throw new BadRequestException(
          'Invalid number of lives in subscription plan.',
        );
      }

      // Get current lives and add the purchased lives
      const currentLives = Number.isFinite(user.lives) ? user.lives : 0;
      user.lives = currentLives + livesToAdd;

      // Update payment info
      user.isPayment = true;
      user.cardNumber = cardNumber;

      await user.save();

      return {
        statusCode: HttpStatus.CREATED,
        message: 'Lives purchased successfully.',
        data: {
          plan: {
            id: plan._id,
            name: plan.name,
            subscriptionType: plan.subscriptionType,
            amount: plan.amount,
            currency: plan.currency,
          },
          livesAdded: livesToAdd,
          totalLives: user.lives,
        },
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async purchaseAvatar(userId: string, purchaseAvatarDto: PurchaseAvatarDto) {
    try {
      const { avatarId } = purchaseAvatarDto;
      const PURCHASE_COST = 3;

      const user = this.assertActiveUser(
        await this.userModel.findById(userId).exec(),
      );

      const currentCoins = Number.isFinite(user.coins) ? user.coins : 0;
      if (currentCoins < PURCHASE_COST) {
        throw new BadRequestException('Insufficient coins to purchase avatar.');
      }

      if (user.purchasedAvatars?.includes(avatarId)) {
        throw new BadRequestException('Avatar already purchased.');
      }

      user.coins = currentCoins - PURCHASE_COST;
      user.purchasedAvatars = [...(user.purchasedAvatars || []), avatarId];

      await user.save();

      return {
        statusCode: HttpStatus.CREATED,
        message: 'Avatar purchased successfully.',
        data: {
          purchasedAvatarId: avatarId,
          coinsLeft: user.coins,
          purchasedAvatars: user.purchasedAvatars,
        },
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async purchaseCoin(userId: string, purchaseCoinDto: PurchaseCoinDto) {
    try {
      const { subscriptionPlanId, cardNumber } = purchaseCoinDto;

      if (!isValidObjectId(subscriptionPlanId)) {
        throw new BadRequestException('Invalid subscription plan ID.');
      }

      const user = this.assertActiveUser(
        await this.userModel.findById(userId).exec(),
      );

      const plan = await this.subscriptionPlanModel
        .findOne({ _id: subscriptionPlanId, isDeleted: false })
        .exec();

      if (!plan) {
        throw new NotFoundException('Subscription plan not found.');
      }

      if (plan.subscriptionType !== SubscriptionType.COINS) {
        throw new BadRequestException(
          'This subscription plan is not for purchasing coins.',
        );
      }

      // Parse the number of coins from the plan name (e.g., "5", "10", "25")
      const coinsToAdd = parseInt(plan.name, 10);
      if (isNaN(coinsToAdd) || coinsToAdd <= 0) {
        throw new BadRequestException(
          'Invalid number of coins in subscription plan.',
        );
      }

      // Get current coins and add the purchased coins
      const currentCoins = Number.isFinite(user.coins) ? user.coins : 0;
      user.coins = currentCoins + coinsToAdd;

      // Update payment info
      user.isPayment = true;
      user.cardNumber = cardNumber;

      await user.save();

      return {
        statusCode: HttpStatus.CREATED,
        message: 'Coins purchased successfully.',
        data: {
          plan: {
            id: plan._id,
            name: plan.name,
            subscriptionType: plan.subscriptionType,
            amount: plan.amount,
            currency: plan.currency,
          },
          coinsAdded: coinsToAdd,
          totalCoins: user.coins,
        },
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
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

  async changePassword(userId: string, changePasswordDto: ChangePasswordDto) {
    try {
      const { oldPassword, newPassword } = changePasswordDto;

      const user = this.assertActiveUser(
        await this.userModel.findById(userId).exec(),
      );

      // Verify old password
      const isOldPasswordValid = await bcrypt.compare(
        oldPassword,
        user.password,
      );

      if (!isOldPasswordValid) {
        throw new BadRequestException('Old password is incorrect.');
      }

      // Hash new password
      const hashedNewPassword = await bcrypt.hash(newPassword, 10);

      // Update password
      user.password = hashedNewPassword;
      await user.save();

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
