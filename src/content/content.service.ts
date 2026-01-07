import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Express } from 'express';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Game } from './schemas/game.schema';
import { Document, FilterQuery, Model, Types } from 'mongoose';
import { SubTopic, SubTopicDocument } from './schemas/subtopic.schema';
import { Topic, TopicDocument } from './schemas/topic.schema';
import { DeckAIService } from './deck-ai.service';
import { Socket } from 'socket.io';
import {
  GameProgress,
  GameProgressDocument,
} from './schemas/game-progress.schema';
import {
  TopicProgress,
  TopicProgressDocument,
} from './schemas/topic-progress.schema';
import { randomUUID } from 'crypto';
import { Content, ContentDocument } from './schemas/content.schema';
import { DeviceAccessService } from './device-access.service';
import { Question } from './interfaces/question.interface';
import { getUploadBasePath } from '../common/multer.service';
import { extname } from 'path';
import { USER_TYPE } from 'src/common/enum';
import { Deck, DeckDocument } from './schemas/deck.schema';
import { User, UserDocument } from '../users/entities/user.entity';
import { UpdateQuery } from 'mongoose';

// Type for authenticated user object
type AuthUser =
  | {
      id?: string;
      _id?: string | Types.ObjectId;
      userId?: string;
    }
  | undefined;

// Helper type for lean document results (when using .lean())
// Maps become Record<string, number> when using .lean()
type LeanTopic = Omit<Topic, keyof Document | 'userPercentages'> & {
  _id: Types.ObjectId;
  userPercentages?: Record<string, number>;
};
type LeanSubTopic = Omit<SubTopic, keyof Document | 'userPercentages'> & {
  _id: Types.ObjectId;
  userPercentages?: Record<string, number>;
};
type LeanDeck = Omit<Deck, keyof Document> & { _id: Types.ObjectId };
type LeanGameProgress = Omit<GameProgress, keyof Document> & {
  _id: Types.ObjectId;
};
type LeanTopicProgress = Omit<TopicProgress, keyof Document> & {
  _id: Types.ObjectId;
};

type ContentFilters = {
  userId?: string;
  deviceId?: string;
  deckId?: string;
  contentType?: string;
};

const LIFE_REFILL_DELAY_MS = 5 * 60 * 1000;
type GameMode = 'DUEL' | 'BRAWL';
type TeamGameMode = 'Regular' | 'Knockout';
type AllGameMode = GameMode | TeamGameMode;

type InviteUserPayload = {
  userId?: string; // Keep for backward compatibility
  userIds?: string[]; // New: array of user IDs to invite
  deviceId?: string;
  gameMode?: AllGameMode; // Support both individual (DUEL/BRAWL) and team (Regular/Knockout) modes
  gameId?: string;
  skipGameInviteEmit?: boolean; // Skip emitting gameInvite event (for team invites that emit their own)
  deckId?: string; // Deck ID for team invites
  topicId?: string; // Topic ID for team invites
};

type AcceptInvitePayload = {
  userId?: string; // Optional - will be found from pending invite if not provided
  deviceId?: string;
  gameId?: string;
};

type CancelInvitePayload = {
  gameId?: string;
  inviterId: string;
};

type ActiveRoom = {
  roomId: string;
  participants: string[];
  deviceId?: string | null;
  gameId?: string | null;
  createdAt: Date;
  mode?: 'Regular' | 'Knockout' | 'DUEL' | 'BRAWL'; // Store game mode in room
  deckId?: string | null; // Deck ID for team invites
  topicId?: string | null; // Topic ID for team invites
};

type PendingInvite = {
  inviteId: string;
  fromUserId: string;
  toUserId: string;
  deviceId?: string | null;
  gameMode?: AllGameMode; // Support both individual (DUEL/BRAWL) and team (Regular/Knockout) modes
  gameId?: string | null;
  createdAt: string;
  deckId?: string | null; // Deck ID for team invites
  topicId?: string | null; // Topic ID for team invites
};

@Injectable()
export class ContentService {
  private userSockets: Map<string, Socket> = new Map();
  private activeRooms: Map<string, ActiveRoom> = new Map();
  private pendingInvites: Map<string, PendingInvite> = new Map();

  constructor(
    @InjectModel(Game.name) private readonly gameModel: Model<Game>,
    @InjectModel(Content.name)
    private readonly contentModel: Model<ContentDocument>,
    @InjectModel(SubTopic.name) private readonly subTopicModel: Model<SubTopic>,
    @InjectModel(Topic.name) private readonly topicModel: Model<TopicDocument>,
    @InjectModel(GameProgress.name)
    private readonly gameProgressModel: Model<GameProgressDocument>,
    @InjectModel(TopicProgress.name)
    private readonly topicProgressModel: Model<TopicProgressDocument>,
    @InjectModel(Deck.name) private readonly deckModel: Model<DeckDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private aiService: DeckAIService,
    private readonly deviceAccessService: DeviceAccessService,
  ) {}

  setUserSockets(sockets: Map<string, Socket>) {
    this.userSockets = sockets;
  }

  /**
   * Remove any active rooms containing the given user.
   * Use this when a user reconnects so stale room state does not persist.
   */
  clearUserRooms(userId: string): number {
    const normalizedUserId = this.normalizeId(userId);
    if (!normalizedUserId) return 0;

    let removed = 0;
    for (const [roomKey, room] of this.activeRooms.entries()) {
      if (room.participants.includes(normalizedUserId)) {
        this.activeRooms.delete(roomKey);
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * Remove pending invites where the user is either inviter or invitee.
   * Helps avoid stale invites after disconnect/reconnect.
   */
  clearPendingInvites(userId: string): number {
    const normalizedUserId = this.normalizeId(userId);
    if (!normalizedUserId) return 0;

    let removed = 0;
    for (const [inviteId, invite] of this.pendingInvites.entries()) {
      if (
        invite.fromUserId === normalizedUserId ||
        invite.toUserId === normalizedUserId
      ) {
        this.pendingInvites.delete(inviteId);
        removed += 1;
      }
    }
    return removed;
  }

  private buildRoomKey(userA: string, userB: string) {
    return [userA, userB].sort().join(':');
  }

  getRoomByUserId(userId: string): ActiveRoom | null {
    const normalizedUserId = this.normalizeId(userId);
    if (!normalizedUserId) return null;

    for (const [roomKey, room] of this.activeRooms.entries()) {
      if (room.participants.includes(normalizedUserId)) {
        return room;
      }
    }
    return null;
  }

  getRoomByRoomId(roomId: string): ActiveRoom | null {
    for (const [roomKey, room] of this.activeRooms.entries()) {
      if (room.roomId === roomId) {
        return room;
      }
    }
    return null;
  }

  private normalizeId<T = unknown>(value: T): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    if (value && typeof value === 'object' && 'toString' in value) {
      const objWithToString = value as { toString(): string };
      return objWithToString.toString();
    }
    return String(value);
  }

  /**
   * Check if user is Individual type - only Individual users can access content service APIs
   */
  private async assertIndividualUser(userId: string): Promise<void> {
    const normalizedUserId = this.normalizeId(userId);
    if (!normalizedUserId) {
      throw new BadRequestException('Invalid user ID');
    }

    const user = await this.userModel.findById(normalizedUserId).lean().exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.userType !== USER_TYPE[0]) {
      throw new ForbiddenException(
        'Only Individual users can access this service',
      );
    }
  }

  private normalizeSubTopicOrder(topic: TopicDocument): string[] {
    return (topic.subTopics ?? [])
      .map((id) => this.normalizeId(id))
      .filter((id): id is string => !!id);
  }

  private async fetchSubTopicAndTopic(subTopicId: string) {
    const normalizedSubTopicId = this.normalizeId(subTopicId);
    if (!normalizedSubTopicId) {
      throw new BadRequestException('Invalid subtopic id');
    }

    const subTopic = await this.subTopicModel.findById(normalizedSubTopicId);
    if (!subTopic) {
      throw new NotFoundException('Subtopic not found');
    }

    const topic = await this.topicModel.findById(subTopic.topicId);
    if (!topic) {
      throw new NotFoundException('Parent topic not found');
    }

    return { subTopic, topic };
  }

  async getSubTopicAndTopic(subTopicId: string) {
    return this.fetchSubTopicAndTopic(subTopicId);
  }

  getGameModel() {
    return this.gameModel;
  }

  getUserModel() {
    return this.userModel;
  }

  getGameProgressModel() {
    return this.gameProgressModel;
  }

  getAiService() {
    return this.aiService;
  }

  private async getOrCreateTopicProgress(
    userId: string,
    topicId: string,
  ): Promise<TopicProgressDocument> {
    const existing = await this.topicProgressModel
      .findOne({ userId, topicId })
      .exec();

    if (existing) {
      return existing;
    }

    return this.topicProgressModel.create({
      userId,
      topicId,
      completedSubTopicIds: [],
      completedCycles: 0,
    });
  }

  async getUserTopicProgress(userId: string, topicId: string) {
    // await this.assertIndividualUser(userId);

    const normalizedUserId = this.normalizeId(userId);
    const normalizedTopicId = this.normalizeId(topicId);

    if (!normalizedUserId) {
      throw new BadRequestException('Invalid user ID');
    }

    if (!normalizedTopicId) {
      throw new BadRequestException('Invalid topic ID');
    }

    // Verify topic exists
    const topic = await this.topicModel.findById(normalizedTopicId);
    if (!topic) {
      throw new NotFoundException('Topic not found');
    }

    // Get or create topic progress
    const progress = await this.getOrCreateTopicProgress(
      normalizedUserId,
      normalizedTopicId,
    );

    // Determine ordered subtopics for the topic
    const orderedSubTopicIds = this.normalizeSubTopicOrder(topic);

    // Build per-subtopic completion state in topic order
    const subTopicProgress = orderedSubTopicIds.map((subTopicId) => ({
      subTopicId,
      isCompleted: progress.completedSubTopicIds?.includes(subTopicId) ?? false,
    }));

    // Show only completed subtopics plus the next pending one
    const firstPendingIndex = subTopicProgress.findIndex(
      (st) => !st.isCompleted,
    );
    const visibleSubTopicProgress =
      firstPendingIndex === -1
        ? subTopicProgress // all completed, show all
        : subTopicProgress.slice(0, firstPendingIndex + 1);

    // Get all subtopic IDs that need to be fetched
    const visibleSubTopicIds = visibleSubTopicProgress.map(
      (st) => st.subTopicId,
    );

    // Fetch all subtopics in one query
    const subtopics = await this.subTopicModel
      .find({ _id: { $in: visibleSubTopicIds } })
      .lean()
      .exec();

    // Create a map of subtopic ID to subtopic document for quick lookup
    const subtopicMap = new Map<string, LeanSubTopic>();
    subtopics.forEach((subtopic) => {
      const subtopicId = this.normalizeId(subtopic._id);
      if (subtopicId) {
        subtopicMap.set(subtopicId, subtopic as unknown as LeanSubTopic);
      }
    });

    // Build subtopic progress with full subtopic data
    const enrichedSubTopicProgress = visibleSubTopicProgress.map((st) => {
      const subtopic = subtopicMap.get(st.subTopicId);
      if (!subtopic) {
        // If subtopic not found, return minimal data
        return {
          _id: st.subTopicId,
          isCompleted: st.isCompleted,
        };
      }

      // Filter userPercentages if userId is provided (similar to getTopicById)
      const filteredUserPercentages: Record<string, number> = {};
      if (subtopic.userPercentages && normalizedUserId) {
        // Handle Map case (Mongoose document)
        if (subtopic.userPercentages instanceof Map) {
          const userPercentage = subtopic.userPercentages.get(normalizedUserId);
          if (userPercentage !== undefined && userPercentage !== null) {
            filteredUserPercentages[normalizedUserId] = userPercentage;
          }
        } else if (
          subtopic.userPercentages &&
          typeof subtopic.userPercentages === 'object' &&
          !Array.isArray(subtopic.userPercentages)
        ) {
          // Handle plain object case (when using .lean(), Maps become objects)
          const userPercentagesObj = subtopic.userPercentages;
          const userPercentage = userPercentagesObj[normalizedUserId];
          if (userPercentage !== undefined && userPercentage !== null) {
            filteredUserPercentages[normalizedUserId] = userPercentage;
          }
        }
      }

      // Filter questionsAsked - only show questions asked by current user
      const filteredQuestionsAsked = (subtopic.questionsAsked || []).filter(
        (qa) => {
          const qaUserId = qa.userId ? this.normalizeId(qa.userId) : null;
          return qaUserId === normalizedUserId;
        },
      );

      // Filter flashcardAccuracies - only show accuracies for current user
      const filteredFlashcardAccuracies = (
        subtopic.flashcardAccuracies || []
      ).filter((fa) => {
        const faUserId = fa.userId ? this.normalizeId(fa.userId) : null;
        return faUserId === normalizedUserId;
      });

      // Filter battleAccuracies - only show accuracies for current user
      const filteredBattleAccuracies = (subtopic.battleAccuracies || []).filter(
        (ba) => {
          const baUserId = ba.userId ? this.normalizeId(ba.userId) : null;
          return baUserId === normalizedUserId;
        },
      );

      // Filter moreDetailsRequests - only show requests made by current user
      const filteredMoreDetailsRequests = (
        subtopic.moreDetailsRequests || []
      ).filter((mdr) => {
        const mdrUserId = mdr.userId ? this.normalizeId(mdr.userId) : null;
        return mdrUserId === normalizedUserId;
      });

      // Return full subtopic data with isCompleted flag and filtered user-specific data
      return {
        ...subtopic,
        userPercentages: normalizedUserId
          ? filteredUserPercentages
          : subtopic.userPercentages,
        questionsAsked: normalizedUserId
          ? filteredQuestionsAsked
          : subtopic.questionsAsked,
        flashcardAccuracies: normalizedUserId
          ? filteredFlashcardAccuracies
          : subtopic.flashcardAccuracies,
        battleAccuracies: normalizedUserId
          ? filteredBattleAccuracies
          : subtopic.battleAccuracies,
        moreDetailsRequests: normalizedUserId
          ? filteredMoreDetailsRequests
          : subtopic.moreDetailsRequests,
        isCompleted: st.isCompleted,
      };
    });

    // Convert to plain object to access timestamps (Mongoose adds createdAt/updatedAt automatically)
    const progressObj = progress.toObject();

    // Return progress data as plain object
    return {
      _id: progressObj._id,
      userId: progressObj.userId,
      topicId: progressObj.topicId,
      completedSubTopicIds: progressObj.completedSubTopicIds || [],
      completedCycles: progressObj.completedCycles || 0,
      lastCycleCompletedAt: progressObj.lastCycleCompletedAt || null,
      createdAt: progressObj.createdAt || null,
      updatedAt: progressObj.updatedAt || null,
      subTopicProgress: enrichedSubTopicProgress,
    };
  }

  private async assertSubTopicAccess(userId: string, subTopicId: string) {
    const normalizedSubTopicId = this.normalizeId(subTopicId);
    if (!normalizedSubTopicId) {
      throw new BadRequestException('Invalid subtopic id');
    }

    const { subTopic, topic } =
      await this.fetchSubTopicAndTopic(normalizedSubTopicId);
    const orderedSubTopicIds = this.normalizeSubTopicOrder(topic);

    if (!orderedSubTopicIds.length) {
      throw new BadRequestException('Topic does not have any subtopics');
    }

    if (!orderedSubTopicIds.includes(normalizedSubTopicId)) {
      throw new BadRequestException(
        'Subtopic is not part of the configured topic sequence',
      );
    }

    const topicId = topic._id.toString();
    const progress = await this.getOrCreateTopicProgress(userId, topicId);
    const normalizedCompleted =
      progress.completedSubTopicIds?.filter((id) =>
        orderedSubTopicIds.includes(id),
      ) ?? [];

    if (normalizedCompleted.length !== progress.completedSubTopicIds.length) {
      progress.completedSubTopicIds = normalizedCompleted;
      await progress.save();
    }

    if (normalizedCompleted.includes(normalizedSubTopicId)) {
      if (normalizedCompleted.length >= orderedSubTopicIds.length) {
        progress.completedSubTopicIds = [];
        progress.completedCycles = (progress.completedCycles ?? 0) + 1;
        progress.lastCycleCompletedAt = new Date();
        await progress.save();
      } else {
        throw new BadRequestException(
          'You have already completed this subtopic. Finish the sequence to restart.',
        );
      }
    }

    const nextAvailableSubTopicId =
      orderedSubTopicIds.find(
        (subId) => !normalizedCompleted.includes(subId),
      ) ?? orderedSubTopicIds[0];

    if (normalizedSubTopicId !== nextAvailableSubTopicId) {
      throw new BadRequestException(
        'Please complete the previous subtopic before proceeding.',
      );
    }

    return { subTopic, topic, progress };
  }

  async markSubTopicCompletedForUser(userId: string, subTopicId: string) {
    // await this.assertIndividualUser(userId);

    const normalizedSubTopicId = this.normalizeId(subTopicId);
    if (!userId || !normalizedSubTopicId) {
      return;
    }

    const { topic } = await this.fetchSubTopicAndTopic(normalizedSubTopicId);
    const orderedSubTopicIds = this.normalizeSubTopicOrder(topic);
    if (!orderedSubTopicIds.length) {
      return;
    }

    const topicId = topic._id.toString();
    const progress = await this.getOrCreateTopicProgress(userId, topicId);
    const normalizedCompleted =
      progress.completedSubTopicIds?.filter((id) =>
        orderedSubTopicIds.includes(id),
      ) ?? [];

    if (normalizedCompleted.includes(normalizedSubTopicId)) {
      return;
    }

    normalizedCompleted.push(normalizedSubTopicId);

    if (normalizedCompleted.length >= orderedSubTopicIds.length) {
      progress.completedSubTopicIds = [];
      progress.completedCycles = (progress.completedCycles ?? 0) + 1;
      progress.lastCycleCompletedAt = new Date();
    } else {
      progress.completedSubTopicIds = normalizedCompleted;
    }

    await progress.save();
  }

  async singlePlayCreateGame(
    userId: string,
    subTopicId: string,
    difficulty: 'easy' | 'medium' | 'hard',
  ): Promise<{
    gameId: string;
    questions: Question[];
    topicId: string;
    subTopicId: string;
    subTopicIndex: number;
    totalSubTopics: number;
    deckId?: string;
    deckName?: string;
  }> {
    // await this.assertIndividualUser(userId);

    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    const { subTopic, topic } = await this.assertSubTopicAccess(
      userId,
      subTopicId,
    );

    const topicId = this.normalizeId(topic._id) as string;
    const orderedSubTopicIds = this.normalizeSubTopicOrder(topic);
    const normalizedSubTopicId = this.normalizeId(subTopicId) as string;
    const subTopicIndex =
      orderedSubTopicIds.findIndex((id) => id === normalizedSubTopicId) + 1;
    const totalSubTopics = orderedSubTopicIds.length;

    // Find the deck that contains this topic (if any) so we can expose deck info
    let deckId: string | undefined;
    let deckName: string | undefined;
    try {
      const deck = await this.deckModel
        .findOne({ contentIds: { $in: [topicId] } })
        .lean()
        .exec();
      if (deck) {
        deckId = this.normalizeId(deck._id) as string;
        deckName = deck.name;
      }
    } catch {
      // best-effort lookup; don't fail game creation if deck lookup fails
    }

    const questions = await this.aiService.generateMCQQuestions(
      subTopic.title,
      subTopic.description,
      difficulty,
    );

    const gameId = randomUUID();

    // Save Game
    await this.gameModel.create({
      gameId,
      type: 'single',
      players: [],
      difficulty,
      subTopicId: normalizedSubTopicId,
      questions,
    });

    // Return gameId + questions + deck info (if available)
    return {
      gameId,
      questions,
      topicId,
      subTopicId: normalizedSubTopicId,
      subTopicIndex,
      totalSubTopics,
      deckId,
      deckName,
    };
  }

  async create(createContentDto: CreateContentDto) {
    if (!createContentDto.userId && !createContentDto.deviceId) {
      throw new BadRequestException('Either userId or deviceId is required');
    }

    if (!createContentDto.userId && createContentDto.deviceId) {
      await this.deviceAccessService.assertActionAllowed(
        createContentDto.deviceId,
        'flashcard',
      );
    }

    const content = await this.contentModel.create({
      ...createContentDto,
      processingStatus: createContentDto.processingStatus ?? 'pending',
      isProcessed: createContentDto.isProcessed ?? false,
      isProcessing: createContentDto.isProcessing ?? false,
    });

    return content;
  }

  async uploadFile(authUser: AuthUser, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const userId = this.extractUserId(authUser);
    if (!userId) {
      throw new BadRequestException('Authenticated user is required');
    }

    // await this.assertIndividualUser(userId);

    const contentType = this.inferContentType(file);

    const basePath = getUploadBasePath().replace(/\/+$/, '');
    const publicPrefix =
      process.env.UPLOAD_PUBLIC_PREFIX ||
      `/${basePath.split('/').filter(Boolean).pop() || ''}`;
    const normalizedPublicPrefix = publicPrefix.startsWith('/')
      ? publicPrefix
      : `/${publicPrefix}`;
    const relativePath = file.path
      .replace(basePath, normalizedPublicPrefix)
      .replace(/\\/g, '/')
      .replace(/\/{2,}/g, '/');
    const publicBaseUrl =
      process.env.FILE_BASE_URL || process.env.APP_BASE_URL || '';
    const normalizedBaseUrl = publicBaseUrl
      ? publicBaseUrl.replace(/\/+$/, '')
      : '';
    const fileUrl = normalizedBaseUrl
      ? `${normalizedBaseUrl}/${relativePath}`
      : relativePath;

    const content = await this.contentModel.create({
      userId,
      contentType,
      contentName: file.originalname,
      filePath: file.path,
      fileUrl,
      processingStatus: 'pending',
      isProcessed: false,
      isProcessing: false,
    });

    return content.toObject();
  }

  private extractUserId(user: AuthUser): string | null {
    if (!user) {
      return null;
    }
    if (user.id) return user.id;
    if (user._id) {
      return typeof user._id === 'string' ? user._id : user._id.toString();
    }
    if (user.userId) return user.userId;
    return null;
  }

  private inferContentType(file: Express.Multer.File): string {
    const mime = file.mimetype?.toLowerCase() ?? '';
    const extension = extname(file.originalname).toLowerCase();

    if (mime.startsWith('image/')) {
      return 'image';
    }
    if (mime.startsWith('audio/')) {
      return 'audio';
    }
    if (mime === 'application/pdf' || extension === '.pdf') {
      return 'pdf';
    }
    if (
      mime === 'application/vnd.ms-powerpoint' ||
      mime ===
        'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      extension === '.ppt' ||
      extension === '.pptx'
    ) {
      return 'ppt';
    }
    if (extension === '.txt' || mime === 'text/plain') {
      return 'note';
    }

    throw new BadRequestException('Unsupported file type');
  }

  async findAll(filters: ContentFilters = {}) {
    const query: FilterQuery<ContentDocument> = {};

    if (filters.userId) {
      query.userId = filters.userId;
    }
    if (filters.deviceId) {
      query.deviceId = filters.deviceId;
    }
    if (filters.deckId) {
      query.deckId = filters.deckId;
    }
    if (filters.contentType) {
      query.contentType = filters.contentType;
    }

    return this.contentModel.find(query).sort({ createdAt: -1 }).lean().exec();
  }

  async findOne(id: string) {
    // Validate that id is a valid ObjectId
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(
        `Invalid content ID: ${id}. Expected a valid MongoDB ObjectId.`,
      );
    }

    const content = await this.contentModel.findById(id).lean().exec();
    if (!content) {
      throw new NotFoundException('Content not found');
    }
    return content;
  }

  async update(id: string, updateContentDto: UpdateContentDto) {
    // Validate that id is a valid ObjectId
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(
        `Invalid content ID: ${id}. Expected a valid MongoDB ObjectId.`,
      );
    }

    const updated = await this.contentModel
      .findByIdAndUpdate(
        id,
        { $set: updateContentDto },
        { new: true, lean: true },
      )
      .exec();

    if (!updated) {
      throw new NotFoundException('Content not found');
    }

    return updated;
  }

  async remove(id: string) {
    // Validate that id is a valid ObjectId
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(
        `Invalid content ID: ${id}. Expected a valid MongoDB ObjectId.`,
      );
    }

    const deleted = await this.contentModel.findByIdAndDelete(id).lean().exec();
    if (!deleted) {
      throw new NotFoundException('Content not found');
    }

    return deleted;
  }

  /**
   * Update daily streak when a game is completed
   * Type 1: 7-day icon tracking (dailyStreakIcons)
   * Type 2: Current daily streak counter (currentDailyStreak)
   */
  async updateDailyStreak(userId: string) {
    // await this.assertIndividualUser(userId);

    const normalizedUserId = this.normalizeId(userId);
    if (!normalizedUserId) {
      return null;
    }

    const progress = await this.gameProgressModel.findOne({
      userId: normalizedUserId,
    });

    if (!progress) {
      return null;
    }

    const today = new Date();
    const todayDateString = this.getDateString(today);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayDateString = this.getDateString(yesterday);

    // Get or initialize dailyGamesCount
    const dailyGamesCount = progress.dailyGamesCount || {};

    // Increment games count for today
    const todayGamesCount = (dailyGamesCount[todayDateString] || 0) + 1;
    dailyGamesCount[todayDateString] = todayGamesCount;

    // Type 2: Update currentDailyStreak
    let currentDailyStreak = progress.currentDailyStreak || 0;
    let longestDailyStreak = progress.longestDailyStreak || 0;

    const lastGamePlayDate = progress.lastGamePlayDate
      ? new Date(progress.lastGamePlayDate)
      : null;
    const lastGameDateString = lastGamePlayDate
      ? this.getDateString(lastGamePlayDate)
      : null;

    if (lastGameDateString === todayDateString) {
      // Same day - don't change streak, just increment games count
      // Streak remains the same
    } else if (lastGameDateString === yesterdayDateString) {
      // Consecutive day - increment streak
      currentDailyStreak += 1;
      if (currentDailyStreak > longestDailyStreak) {
        longestDailyStreak = currentDailyStreak;
      }
    } else if (lastGameDateString && lastGameDateString !== todayDateString) {
      // Not consecutive - reset to 1
      currentDailyStreak = 1;
    } else {
      // First time playing - start at 1
      currentDailyStreak = 1;
      if (longestDailyStreak === 0) {
        longestDailyStreak = 1;
      }
    }

    // Type 1: Update 7-day icon system
    const dailyStreakIcons = this.update7DayIcons(dailyGamesCount);

    // Update progress
    const updated = await this.gameProgressModel.findOneAndUpdate(
      { userId: normalizedUserId },
      {
        $set: {
          lastGamePlayDate: today,
          currentDailyStreak,
          longestDailyStreak,
          dailyStreakIcons,
          dailyGamesCount,
        },
      },
      { new: true },
    );

    return updated;
  }

  /**
   * Get date string in YYYY-MM-DD format
   */
  private getDateString(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Get Monday-start week date for a given day (00:00 time)
   */
  private getStartOfWeek(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0 (Sun) - 6 (Sat)
    const diff = (day + 6) % 7; // convert so Monday = 0
    d.setDate(d.getDate() - diff);
    return d;
  }

  /**
   * Update weekly icon array based on games played
   * Returns array of 7 elements for current week (Mon-Sun)
   * - "true": 1 game completed
   * - "fire": 2+ games completed
   * - "cross": 0 games on past days (day already completed)
   * - "": empty string for today if no games played yet (day not completed)
   */
  private update7DayIcons(dailyGamesCount: Record<string, number>): string[] {
    const icons: string[] = [];
    const today = new Date();
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const todayDateString = this.getDateString(today);
    const startOfWeek = this.getStartOfWeek(today); // Monday

    // Build Monday -> Sunday of the current week
    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + i);
      const dateString = this.getDateString(date);
      const gamesCount = dailyGamesCount[dateString] || 0;
      const isToday = dateString === todayDateString;
      const isFuture = date > todayStart;

      if (gamesCount === 0) {
        // For today and future days with no play, leave empty; past days get cross
        icons.push(isToday || isFuture ? '' : 'cross');
      } else if (gamesCount === 1) {
        icons.push('true');
      } else {
        // 2 or more games
        icons.push('fire');
      }
    }

    return icons;
  }

  /**
   * Build week meta (Mon-Sun) with icon + date string for clarity
   */
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
   * Reset daily streak if user didn't play today
   * This should be called daily (via cron job or scheduled task)
   */
  async checkAndResetDailyStreak(userId: string) {
    // await this.assertIndividualUser(userId);

    const normalizedUserId = this.normalizeId(userId);
    if (!normalizedUserId) {
      return null;
    }

    const progress = await this.gameProgressModel.findOne({
      userId: normalizedUserId,
    });

    if (!progress) {
      return null;
    }

    const today = new Date();
    const todayDateString = this.getDateString(today);
    const lastGamePlayDate = progress.lastGamePlayDate
      ? new Date(progress.lastGamePlayDate)
      : null;
    const lastGameDateString = lastGamePlayDate
      ? this.getDateString(lastGamePlayDate)
      : null;

    // If last game was not today, reset currentDailyStreak to 0
    if (lastGameDateString !== todayDateString) {
      const updated = await this.gameProgressModel.findOneAndUpdate(
        { userId: normalizedUserId },
        {
          $set: {
            currentDailyStreak: 0,
          },
        },
        { new: true },
      );

      return updated;
    }

    return progress;
  }

  async updateProgressAfterQuestion(userId: string, isCorrect: boolean) {
    // await this.assertIndividualUser(userId);

    const progress = await this.gameProgressModel.findOne({ userId });
    const today = new Date().toDateString();

    let currentDailyStreak = progress?.currentDailyStreak || 0;
    let longestDailyStreak = progress?.longestDailyStreak || 0;

    // streak calculation on every question
    if (progress?.lastGamePlayDate?.toDateString() !== today) {
      currentDailyStreak += 1;
      if (currentDailyStreak > longestDailyStreak) {
        longestDailyStreak = currentDailyStreak;
      }
    }

    const correctInc = isCorrect ? 1 : 0;
    const wrongInc = isCorrect ? 0 : 1;

    const newTotalCorrect = (progress?.totalCorrectAnswers || 0) + correctInc;
    const newLevel = progress?.level || 1;
    const nextLevelThreshold = newLevel * 50;
    const levelProgressPercent = Math.min(
      (newTotalCorrect / nextLevelThreshold) * 100,
      100,
    );

    const updateData: UpdateQuery<GameProgressDocument> = {
      $set: {
        lastGamePlayDate: new Date(),
        currentDailyStreak,
        longestDailyStreak,
        levelProgress: {
          currentLevel: newLevel,
          nextLevelThreshold,
          progress: levelProgressPercent,
        },
      },
      $inc: {
        totalCorrectAnswers: correctInc,
        totalWrongAnswers: wrongInc,
        totalQuestions: 1,
        gamesPlayed: 1,
        totalScore: correctInc,
      },
    };

    const updated = await this.gameProgressModel.findOneAndUpdate(
      { userId },
      updateData,
      { upsert: true, new: true },
    );

    return updated;
  }

  async completeGame(gameId: string, update: Partial<Game>) {
    return await this.gameModel.updateOne(
      { gameId },
      {
        $set: {
          isCompleted: true,
          ...update,
        },
      },
    );
  }

  async incrementTotalGamesPlayed(userId: string) {
    // await this.assertIndividualUser(userId);

    const updated = await this.gameProgressModel.findOneAndUpdate(
      { userId },
      {
        $inc: {
          totalGamesPlayed: 1,
        },
      },
      { upsert: true, new: true },
    );

    return updated;
  }

  /**
   * Calculate badge based on points
   * Badges cycle every 100 points:
   * 1-20: Spark
   * 21-40: Momentum
   * 41-60: Breakthrough
   * 61-80: Pioneer
   * 81-100: Mastery
   */
  private calculateBadge(points: number): string {
    // Handle special case: when points is exactly 100, 200, etc., it should be Mastery
    if (points > 0 && points % 100 === 0) {
      return 'Mastery';
    }

    const pointsInCycle = points % 100;

    if (pointsInCycle >= 1 && pointsInCycle <= 20) {
      return 'Spark';
    } else if (pointsInCycle >= 21 && pointsInCycle <= 40) {
      return 'Momentum';
    } else if (pointsInCycle >= 41 && pointsInCycle <= 60) {
      return 'Breakthrough';
    } else if (pointsInCycle >= 61 && pointsInCycle <= 80) {
      return 'Pioneer';
    } else {
      return 'Mastery';
    }
  }

  /**
   * Calculate level based on points
   * Level increases at 100 points: 1-100 = level 1, 101-200 = level 2, etc.
   * Max level is 20
   */
  private calculateLevel(points: number): number {
    if (points === 0) {
      return 1;
    }
    // Level calculation: 1-100 = level 1, 101-200 = level 2, 201-300 = level 3, etc.
    // Formula: level = Math.floor((points - 1) / 100) + 1
    // For 1: Math.floor((1-1)/100) + 1 = 0 + 1 = 1 ✓
    // For 100: Math.floor((100-1)/100) + 1 = 0 + 1 = 1 ✓
    // For 101: Math.floor((101-1)/100) + 1 = 1 + 1 = 2 ✓
    // For 200: Math.floor((200-1)/100) + 1 = 1 + 1 = 2 ✓
    // For 201: Math.floor((201-1)/100) + 1 = 2 + 1 = 3 ✓
    const level = Math.floor((points - 1) / 100) + 1;
    return Math.min(level, 20); // Cap at level 20
  }

  /**
   * Calculate all badges earned in current level only
   * Returns array of badges earned in the current level (not previous levels)
   * Badges cycle every 100 points: 1-100 same as 101-200, 201-300, etc.
   */
  private calculateAllEarnedBadges(points: number): string[] {
    const badges: string[] = [];
    const badgeOrder = [
      'Spark',
      'Momentum',
      'Breakthrough',
      'Pioneer',
      'Mastery',
    ];

    if (points === 0) {
      return [];
    }

    // Calculate badges earned in current level only
    // For level 1: 1-100, for level 2: 101-200, etc.
    const pointsInCurrentCycle = points % 100;

    // Special case: when points is exactly 100, 200, etc. (end of level)
    // At 100 points (end of level 1), user has earned all badges
    if (points > 0 && points % 100 === 0) {
      return [...badgeOrder]; // Return all badges (Mastery level)
    }

    if (pointsInCurrentCycle > 0) {
      // Badge ranges within each 100-point cycle:
      // 1-20 or 101-120 or 201-220: Spark
      // 21-40 or 121-140 or 221-240: Momentum
      // 41-60 or 141-160 or 241-260: Breakthrough
      // 61-80 or 161-180 or 261-280: Pioneer
      // 81-100 or 181-200 or 281-300: Mastery
      if (pointsInCurrentCycle >= 1 && pointsInCurrentCycle <= 20) {
        badges.push('Spark');
      } else if (pointsInCurrentCycle >= 21 && pointsInCurrentCycle <= 40) {
        badges.push('Spark', 'Momentum');
      } else if (pointsInCurrentCycle >= 41 && pointsInCurrentCycle <= 60) {
        badges.push('Spark', 'Momentum', 'Breakthrough');
      } else if (pointsInCurrentCycle >= 61 && pointsInCurrentCycle <= 80) {
        badges.push('Spark', 'Momentum', 'Breakthrough', 'Pioneer');
      } else if (pointsInCurrentCycle >= 81 && pointsInCurrentCycle <= 99) {
        badges.push(...badgeOrder);
      }
    }

    return badges;
  }

  async awardPointsAndCoins(userId: string, points: number, coins: number) {
    // await this.assertIndividualUser(userId);

    const normalizedUserId = this.normalizeId(userId);
    if (!normalizedUserId) {
      return null;
    }

    // Get current progress to calculate new badge and level
    const currentProgress = await this.gameProgressModel.findOne({
      userId: normalizedUserId,
    });

    const currentPoints = currentProgress?.points || 0;
    const newPoints = currentPoints + points;

    // Calculate new badge and level
    const newBadge = this.calculateBadge(newPoints);
    const newLevel = this.calculateLevel(newPoints);

    // Update GameProgress with points, coins, badge, and level
    const gameProgress = await this.gameProgressModel.findOneAndUpdate(
      { userId: normalizedUserId },
      {
        $inc: {
          points: points,
          coins: coins,
        },
        $set: {
          level: newLevel,
          badges: [newBadge],
        },
      },
      { upsert: true, new: true },
    );

    // Update User coins
    await this.userModel.findByIdAndUpdate(
      normalizedUserId,
      {
        $inc: {
          coins: coins,
        },
      },
      { new: true },
    );

    return gameProgress;
  }

  async decrementLives(userId: string, amount: number = 1) {
    // await this.assertIndividualUser(userId);

    const updated = await this.gameProgressModel.findOneAndUpdate(
      { userId },
      {
        $inc: {
          lives: -amount,
        },
      },
      { upsert: true, new: true },
    );

    if (!updated) {
      return null;
    }

    if (updated.lives < 0) {
      updated.lives = 0;
    }

    if (updated.lives === 0) {
      updated.nextLivesRefillAt = new Date(Date.now() + LIFE_REFILL_DELAY_MS);
    } else if (updated.nextLivesRefillAt) {
      updated.nextLivesRefillAt = null;
    }

    await updated.save();
    return updated;
  }

  async deductCoins(userId: string, amount: number = 5) {
    // await this.assertIndividualUser(userId);

    const normalizedUserId = this.normalizeId(userId);
    if (!normalizedUserId) {
      throw new BadRequestException('Invalid user ID');
    }

    // Ensure amount is positive and defaults to 5
    const coinsToDeduct = amount > 0 ? amount : 5;

    // Get current coins from User model to check if user has enough coins
    const user = await this.userModel.findById(normalizedUserId).lean().exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const currentUserCoins = user.coins || 0;
    if (currentUserCoins < coinsToDeduct) {
      throw new BadRequestException('Insufficient coins');
    }

    // Deduct coins from GameProgress
    const gameProgress = await this.gameProgressModel.findOneAndUpdate(
      { userId: normalizedUserId },
      {
        $inc: {
          coins: -coinsToDeduct,
        },
      },
      { upsert: true, new: true },
    );

    // Deduct coins from User model
    const updatedUser = await this.userModel.findByIdAndUpdate(
      normalizedUserId,
      {
        $inc: {
          coins: -coinsToDeduct,
        },
      },
      { new: true, lean: true },
    );

    return {
      success: true,
      coinsDeducted: coinsToDeduct,
      remainingCoins: updatedUser?.coins || 0,
      gameProgress: gameProgress,
    };
  }

  async updateSubTopicUserAccuracy(
    subTopicId: string,
    userId: string,
    accuracy: number,
  ) {
    if (!subTopicId || !userId || Number.isNaN(accuracy)) {
      return;
    }

    const normalizedAccuracy = Math.max(0, Math.min(100, accuracy));

    await this.subTopicModel.findByIdAndUpdate(subTopicId, {
      $set: {
        [`userPercentages.${userId}`]: normalizedAccuracy,
      },
    });
  }

  async requestPublicAccess(userId: string, deckId: string) {
    // await this.assertIndividualUser(userId);

    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    if (!deckId) {
      throw new BadRequestException('Deck ID is required');
    }

    const deck = await this.deckModel.findById(deckId);
    if (!deck) {
      throw new NotFoundException('Deck not found');
    }

    // Verify that the deck belongs to the user
    const normalizedUserId = this.normalizeId(userId);
    const normalizedDeckUserId = this.normalizeId(deck.userId);

    if (normalizedDeckUserId !== normalizedUserId) {
      throw new BadRequestException(
        'You can only request public access for your own decks',
      );
    }

    // Check if deck is already approved/published
    if (deck.status === 'approve') {
      throw new BadRequestException('Your deck is already published');
    }

    // Update status to pending and isPublic to true
    const updated = await this.deckModel.findByIdAndUpdate(
      deckId,
      { $set: { status: 'pending', isPublic: true } },
      { new: true, lean: true },
    );

    return updated;
  }

  async getMyDecks(userId: string) {
    // 1️⃣ Validate userId
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    const normalizedUserId = this.normalizeId(userId);

    // 2️⃣ Fetch all decks of user
    const decks = await this.deckModel
      .find({ userId: normalizedUserId })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    // 3️⃣ Collect all unique topicIds from all decks
    const allTopicIds: string[] = Array.from(
      new Set(
        decks.flatMap((deck) =>
          (deck.contentIds || [])
            .map((id) => this.normalizeId(id))
            .filter((id): id is string => !!id),
        ),
      ),
    );

    // 4️⃣ Fetch topics in one query
    const allTopics = await this.topicModel
      .find({ _id: { $in: allTopicIds } })
      .lean()
      .exec();

    // 5️⃣ Fetch topic progress records in one query
    const allTopicProgressRecords = await this.topicProgressModel
      .find({
        userId: normalizedUserId,
        topicId: { $in: allTopicIds },
      })
      .lean()
      .exec();

    // 6️⃣ Create lookup maps
    const topicsMap = new Map<string, LeanTopic>(
      allTopics.map((topic) => [
        this.normalizeId(topic._id) as string,
        topic as unknown as LeanTopic,
      ]),
    );

    const progressMap = new Map<string, LeanTopicProgress>(
      allTopicProgressRecords.map((progress) => [
        this.normalizeId(progress.topicId) as string,
        progress as unknown as LeanTopicProgress,
      ]),
    );

    // 7️⃣ Process each deck
    const decksWithPercentage = decks.map((deck) => {
      const totalCard = (deck.contentIds || []).length;

      const topicIds = (deck.contentIds || [])
        .map((id) => this.normalizeId(id))
        .filter((id): id is string => !!id);

      if (topicIds.length === 0) {
        return { ...deck, percentage: 0, totalCard };
      }

      // 8️⃣ Get topics from map
      const topics = topicIds
        .map((id) => topicsMap.get(id))
        .filter((topic): topic is LeanTopic => topic !== undefined);

      // 9️⃣ Collect all subtopic IDs using flatMap (no loop needed)
      const allSubTopicIds: string[] = topics
        .flatMap((topic) => topic.subTopics || [])
        .map((id) => this.normalizeId(id))
        .filter((id): id is string => !!id);

      const totalSubTopics = allSubTopicIds.length;

      if (totalSubTopics === 0) {
        return { ...deck, percentage: 0, totalCard };
      }

      // 🔟 Collect completed subtopics using flatMap (no nested loops)
      const completedSubTopicIdsSet = new Set<string>(
        topicIds
          .map((id) => progressMap.get(id))
          .filter(
            (progress): progress is LeanTopicProgress => progress !== undefined,
          )
          .flatMap((progress) => progress.completedSubTopicIds || [])
          .map((id) => this.normalizeId(id))
          .filter((id): id is string => !!id),
      );

      // 1️⃣1️⃣ Count completed subtopics only from deck
      const completedInDeck = Array.from(completedSubTopicIdsSet).filter((id) =>
        allSubTopicIds.includes(id),
      );

      const percentage = Math.round(
        (completedInDeck.length / totalSubTopics) * 100,
      );

      return {
        ...deck,
        percentage,
        totalCard,
      };
    });

    return decksWithPercentage;
  }

  /**
   * Update a deck's name. Only the deck owner can perform this action.
   */
  async updateDeckName(deckId: string, userId: string, name: string) {
    // await this.assertIndividualUser(userId);

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

    const deck = await this.deckModel.findById(normalizedDeckId);
    if (!deck) {
      throw new NotFoundException('Deck not found');
    }

    const deckOwnerId = this.normalizeId(deck.userId);
    if (deckOwnerId !== normalizedUserId) {
      throw new BadRequestException('You can only update decks you created');
    }

    deck.name = trimmedName;
    await deck.save();

    return deck.toObject();
  }

  async getLibrary(
    userId: string | null,
    filter: 'private' | 'public',
    page: number = 1,
    limit: number = 10,
    category?: string,
  ) {
    if (userId) {
      // await this.assertIndividualUser(userId);
    }

    const skip = (page - 1) * limit;
    const query: FilterQuery<DeckDocument> = {};

    if (filter === 'private') {
      if (!userId) {
        throw new BadRequestException(
          'User authentication required for private decks',
        );
      }
      const normalizedUserId = this.normalizeId(userId);
      query.userId = normalizedUserId;
      query.isPublic = false;
      query.status = 'pending';
    } else if (filter === 'public') {
      query.isPublic = true;
      query.status = 'approve';
    } else {
      throw new BadRequestException(
        'Filter must be either "private" or "public"',
      );
    }

    // Add category filter if provided
    if (category) {
      query.category = category;
    }

    const total = await this.deckModel.countDocuments(query).exec();
    const decks = await this.deckModel
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    // Get all unique userIds from decks
    const userIds = Array.from(
      new Set(
        decks
          .map((deck) => this.normalizeId(deck.userId))
          .filter((id): id is string => !!id),
      ),
    );

    // Fetch all users
    const users = await this.userModel
      .find({ _id: { $in: userIds } })
      .select('_id name profileImage avatarId purchasedAvatars')
      .lean()
      .exec();

    // Create user map for quick lookup
    type LeanUserLibrary = {
      _id: Types.ObjectId;
      name?: string | null;
      profileImage?: string;
      avatarId?: string[];
      purchasedAvatars?: string[];
    };
    const userMap = new Map<string, LeanUserLibrary>();
    users.forEach((user) => {
      const userId = this.normalizeId(user._id);
      if (userId) {
        userMap.set(userId, user as unknown as LeanUserLibrary);
      }
    });

    // Get all unique topic IDs from all decks
    const allTopicIds = Array.from(
      new Set(
        decks
          .flatMap((deck) => deck.contentIds || [])
          .map((id) => this.normalizeId(id))
          .filter((id): id is string => !!id),
      ),
    );

    // Fetch all topics
    const topics = await this.topicModel
      .find({ _id: { $in: allTopicIds } })
      .lean()
      .exec();

    // Create topic map for quick lookup
    const topicMap = new Map<string, LeanTopic>();
    topics.forEach((topic) => {
      const topicId = this.normalizeId(topic._id);
      if (topicId) {
        topicMap.set(topicId, topic as unknown as LeanTopic);
      }
    });

    // Get all unique subtopic IDs from all topics
    const allSubTopicIds = Array.from(
      new Set(
        topics
          .flatMap((topic) => topic.subTopics || [])
          .map((id) => this.normalizeId(id))
          .filter((id): id is string => !!id),
      ),
    );

    // Fetch all subtopics
    const subtopics = await this.subTopicModel
      .find({ _id: { $in: allSubTopicIds } })
      .lean()
      .exec();

    // Create subtopic map for quick lookup
    const subtopicMap = new Map<string, LeanSubTopic>();
    subtopics.forEach((subtopic) => {
      const subtopicId = this.normalizeId(subtopic._id);
      if (subtopicId) {
        subtopicMap.set(subtopicId, subtopic as unknown as LeanSubTopic);
      }
    });

    // Fetch topic progress records if userId is provided (for percentage calculation)
    let progressMap = new Map<string, LeanTopicProgress>();
    if (userId) {
      const normalizedUserId = this.normalizeId(userId);
      if (normalizedUserId && allTopicIds.length > 0) {
        const allTopicProgressRecords = await this.topicProgressModel
          .find({
            userId: normalizedUserId,
            topicId: { $in: allTopicIds },
          })
          .lean()
          .exec();

        progressMap = new Map<string, LeanTopicProgress>(
          allTopicProgressRecords.map((progress) => [
            this.normalizeId(progress.topicId) as string,
            progress as unknown as LeanTopicProgress,
          ]),
        );
      }
    }

    // Populate decks with user name and full topic/subtopic data
    const populatedDecks = decks.map((deck) => {
      const deckUserId = this.normalizeId(deck.userId);
      const user = deckUserId ? userMap.get(deckUserId) : null;

      // Populate topics with subtopics
      const populatedTopics = (deck.contentIds || [])
        .map((topicId) => {
          const normalizedTopicId = this.normalizeId(topicId);
          if (!normalizedTopicId) return null;

          const topic = topicMap.get(normalizedTopicId);
          if (!topic) return null;

          // Populate subtopics for this topic
          const populatedSubTopics = (topic.subTopics || [])
            .map((subTopicId) => {
              const normalizedSubTopicId = this.normalizeId(subTopicId);
              if (!normalizedSubTopicId) return null;
              return subtopicMap.get(normalizedSubTopicId) || null;
            })
            .filter((st): st is LeanSubTopic => st !== null);

          return {
            ...topic,
            subTopics: populatedSubTopics,
          };
        })
        .filter(
          (topic): topic is LeanTopic & { subTopics: LeanSubTopic[] } =>
            topic !== null,
        );

      // Calculate deckPercentage if userId is provided
      let deckPercentage: number | null = null;
      if (userId) {
        const normalizedUserId = this.normalizeId(userId);
        if (normalizedUserId) {
          const topicIds = (deck.contentIds || [])
            .map((id) => this.normalizeId(id))
            .filter((id): id is string => !!id);

          if (topicIds.length > 0) {
            // Get topics from map
            const deckTopics = topicIds
              .map((id) => topicMap.get(id))
              .filter((topic): topic is LeanTopic => topic !== undefined);

            // Collect all subtopic IDs from deck topics
            const allSubTopicIds: string[] = deckTopics
              .flatMap((topic) => topic.subTopics || [])
              .map((id) => this.normalizeId(id))
              .filter((id): id is string => !!id);

            const totalSubTopics = allSubTopicIds.length;

            if (totalSubTopics > 0) {
              // Collect completed subtopics from progress records
              const completedSubTopicIdsSet = new Set<string>(
                topicIds
                  .map((id) => progressMap.get(id))
                  .filter(
                    (progress): progress is LeanTopicProgress =>
                      progress !== undefined,
                  )
                  .flatMap((progress) => progress.completedSubTopicIds || [])
                  .map((id) => this.normalizeId(id))
                  .filter((id): id is string => !!id),
              );

              // Count completed subtopics only from deck
              const completedInDeck = Array.from(
                completedSubTopicIdsSet,
              ).filter((id) => allSubTopicIds.includes(id));

              deckPercentage = Math.round(
                (completedInDeck.length / totalSubTopics) * 100,
              );
            } else {
              deckPercentage = 0;
            }
          } else {
            deckPercentage = 0;
          }
        }
      }

      return {
        ...deck,
        userName: user?.name || null,
        userProfileImage: user?.profileImage || null,
        userAvatar: user?.avatarId || null,
        userPurchasedAvatarId: user?.purchasedAvatars || null,
        topics: populatedTopics,
        deckPercentage,
      };
    });

    const totalPages = Math.ceil(total / limit);

    return {
      data: populatedDecks,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  async inviteUserToGame(inviterId: string, data: InviteUserPayload) {
    // await this.assertIndividualUser(inviterId);

    const normalizedInviterId = this.normalizeId(inviterId);

    if (!normalizedInviterId) {
      throw new BadRequestException('Inviter ID is required');
    }

    // Support both single userId and array of userIds
    const userIdsToInvite: string[] = [];
    if (data?.userIds && Array.isArray(data.userIds)) {
      // New: multiple users
      userIdsToInvite.push(...data.userIds);
    } else if (data?.userId) {
      // Backward compatibility: single user
      userIdsToInvite.push(data.userId);
    } else {
      throw new BadRequestException(
        'Either userId or userIds array is required',
      );
    }

    if (userIdsToInvite.length === 0) {
      throw new BadRequestException('At least one user ID is required');
    }

    // Get or create room for the inviter
    const inviterRoom = this.getRoomByUserId(normalizedInviterId);
    let roomId = data?.gameId ?? null;

    // If inviter doesn't have a room, we'll create one when first invite is accepted
    // For now, generate a roomId that will be used for all invites
    if (!roomId) {
      roomId = randomUUID();
    }

    // If room already exists and deckId/topicId are provided, update the room
    if (inviterRoom && roomId === inviterRoom.roomId) {
      if (data.deckId && !inviterRoom.deckId) {
        inviterRoom.deckId = data.deckId;
      }
      if (data.topicId && !inviterRoom.topicId) {
        inviterRoom.topicId = data.topicId;
      }
      // Update the room in the map
      this.activeRooms.set(inviterRoom.roomId, inviterRoom);
    }

    const invites: PendingInvite[] = [];
    const skippedReasons: string[] = [];

    // Normalize and validate all user IDs first
    const normalizedUserIds = userIdsToInvite
      .map((id) => this.normalizeId(id))
      .filter((id): id is string => !!id);

    if (normalizedUserIds.length === 0) {
      throw new BadRequestException('No valid user IDs provided');
    }

    // Verify all users exist in the database and filter online users
    const users = await this.userModel
      .find({
        _id: { $in: normalizedUserIds },
        isOnline: true, // Filter online users directly in query
      })
      .select('_id name isOnline')
      .lean()
      .exec();

    // Create user lookup maps for O(1) access
    const existingUserIds = new Set(
      users
        .map((u) => this.normalizeId(u._id))
        .filter((id): id is string => !!id),
    );
    const userMap = new Map(
      users
        .map((u) => {
          const userId = this.normalizeId(u._id);
          return userId ? [userId, u] : null;
        })
        .filter(
          (entry): entry is [string, (typeof users)[0]] => entry !== null,
        ),
    );
    const roomParticipantsSet = inviterRoom
      ? new Set(inviterRoom.participants)
      : new Set<string>();

    // Filter valid users before processing using array methods
    const validUserIds = normalizedUserIds.filter((userId) => {
      // Check if user exists in database
      if (!existingUserIds.has(userId)) {
        skippedReasons.push(`User ${userId} not found`);
        return false;
      }

      // Check for self-invite
      if (normalizedInviterId === userId) {
        skippedReasons.push('Cannot invite yourself');
        return false;
      }

      // Check if user is already in the inviter's room
      if (roomParticipantsSet.has(userId)) {
        skippedReasons.push(`User ${userId} is already in the room`);
        return false;
      }

      // Check if user has an active socket
      if (!this.userSockets.has(userId)) {
        skippedReasons.push(`User ${userId} is socket not connected`);
        return false;
      }

      // User is online (already filtered in query) and all checks passed
      return true;
    });

    // Process valid users using array methods (forEach instead of for loop)
    const gameMode = data.gameMode ?? 'DUEL';
    validUserIds.forEach((userId) => {
      const targetSocket = this.userSockets.get(userId);
      if (!targetSocket) return; // Safety check

      // Create and send invite
      const inviteId = randomUUID();
      const invitePayload: PendingInvite = {
        inviteId,
        fromUserId: normalizedInviterId,
        toUserId: userId,
        deviceId: data.deviceId ?? null,
        gameMode: gameMode,
        gameId: roomId,
        createdAt: new Date().toISOString(),
        deckId: data.deckId ?? null,
        topicId: data.topicId ?? null,
      };

      // Store the pending invite
      this.pendingInvites.set(inviteId, invitePayload);

      // Send invite to user based on game mode (skip if skipGameInviteEmit is true)
      if (!data.skipGameInviteEmit) {
        // Check if mode is team game mode (Regular or Knockout)
        if (gameMode === 'Regular' || gameMode === 'Knockout') {
          // Emit teamGameInvite for team game modes
          targetSocket.emit('teamGameInvite', invitePayload);
        } else if (gameMode === 'DUEL' || gameMode === 'BRAWL') {
          // Emit gameInvite for individual game modes
          targetSocket.emit('gameInvite', invitePayload);
        }
      }

      invites.push(invitePayload);
    });

    if (invites.length === 0) {
      const errorMessage =
        skippedReasons.length > 0
          ? `No valid users to invite. Reasons: ${skippedReasons.join('; ')}`
          : 'No valid users to invite';
      throw new BadRequestException(errorMessage);
    }

    // Return all invites (for backward compatibility, return first if single user was used)
    return data?.userId ? invites[0] : invites;
  }

  // Helper method to find pending invite for a user
  findPendingInviteForUser(
    acceptorId: string,
    gameId?: string,
  ): PendingInvite | null {
    const normalizedAcceptorId = this.normalizeId(acceptorId);
    if (!normalizedAcceptorId) {
      return null;
    }

    // Use Array.find() instead of manual loop - cleaner and more functional
    const inviteEntry = Array.from(this.pendingInvites.entries()).find(
      ([inviteId, invite]) =>
        invite.toUserId === normalizedAcceptorId &&
        (!gameId || invite.gameId === gameId),
    );

    return inviteEntry ? inviteEntry[1] : null;
  }

  async acceptInvite(acceptorId: string, data: AcceptInvitePayload) {
    // await this.assertIndividualUser(acceptorId);

    const normalizedAcceptorId = this.normalizeId(acceptorId);

    // If userId is not provided in data, try to find it from pending invites
    let normalizedInviterId = this.normalizeId(data?.userId);

    if (!normalizedInviterId) {
      // Try to find the invite first to get the inviter ID
      const foundInvite = this.findPendingInviteForUser(
        acceptorId,
        data?.gameId,
      );
      if (foundInvite) {
        normalizedInviterId = this.normalizeId(foundInvite.fromUserId);
      }
    }

    if (!normalizedAcceptorId) {
      throw new BadRequestException('Accepting user ID is required');
    }

    if (!normalizedInviterId) {
      throw new BadRequestException('Inviter user ID is required');
    }

    if (normalizedAcceptorId === normalizedInviterId) {
      throw new BadRequestException('You cannot accept your own invite');
    }

    // For team games, allow accepting even if inviter is offline (they're just the host/viewer)
    // Check if this is a team game by looking at the pending invite
    // ✅ OPTIMIZATION: Using Array.find() instead of manual loop for cleaner code
    // Single pass through pendingInvites - captures both invite and inviteId in one pass
    const inviteEntry = Array.from(this.pendingInvites.entries()).find(
      ([inviteId, invite]) => {
        const matchesAcceptor = invite.toUserId === normalizedAcceptorId;
        const matchesInviter =
          !normalizedInviterId || invite.fromUserId === normalizedInviterId;
        const matchesGameId = !data.gameId || invite.gameId === data.gameId;
        return matchesAcceptor && matchesInviter && matchesGameId;
      },
    );

    const foundInvite = inviteEntry ? inviteEntry[1] : null;
    const foundInviteId = inviteEntry ? inviteEntry[0] : null;

    // Remove found invite from pending invites
    if (foundInviteId) {
      this.pendingInvites.delete(foundInviteId);
    }

    const isTeamGame =
      foundInvite?.gameMode === 'Regular' ||
      foundInvite?.gameMode === 'Knockout';

    if (!isTeamGame) {
      const inviterSocket = this.userSockets.get(normalizedInviterId);
      if (!inviterSocket) {
        throw new BadRequestException('Inviting user is offline');
      }
    }

    const acceptorSocket = this.userSockets.get(normalizedAcceptorId);
    if (!acceptorSocket) {
      throw new BadRequestException('Accepting user is offline');
    }

    // If no pending invite exists, block room creation to avoid stale/early accepts
    if (!foundInvite) {
      throw new BadRequestException('No pending invite found for this user');
    }

    // Check if inviter already has a room
    let inviterRoom = this.getRoomByUserId(normalizedInviterId);
    let roomId = data?.gameId ?? foundInvite?.gameId ?? null;

    if (inviterRoom) {
      // Inviter already has a room - add acceptor to existing room
      if (!inviterRoom.participants.includes(normalizedAcceptorId)) {
        inviterRoom.participants.push(normalizedAcceptorId);
      }
      // Update deckId and topicId from invite if not already set
      if (foundInvite?.deckId && !inviterRoom.deckId) {
        inviterRoom.deckId = foundInvite.deckId;
      }
      if (foundInvite?.topicId && !inviterRoom.topicId) {
        inviterRoom.topicId = foundInvite.topicId;
      }
      // Update mode from invite if provided
      if (foundInvite?.gameMode && !inviterRoom.mode) {
        inviterRoom.mode = foundInvite.gameMode as ActiveRoom['mode'];
      }
      // Update the room in the map (use roomId as key)
      this.activeRooms.set(inviterRoom.roomId, inviterRoom);
      roomId = inviterRoom.roomId;
    } else {
      // Create new room with inviter and acceptor
      if (!roomId) {
        roomId = randomUUID();
      }

      const roomState: ActiveRoom = {
        roomId,
        participants: [normalizedInviterId, normalizedAcceptorId],
        deviceId: data?.deviceId ?? null,
        gameId: roomId,
        createdAt: new Date(),
        mode: foundInvite?.gameMode as ActiveRoom['mode'] | undefined,
        deckId: foundInvite?.deckId ?? null,
        topicId: foundInvite?.topicId ?? null,
      };

      // Use roomId as the key for multi-user rooms
      this.activeRooms.set(roomId, roomState);
      inviterRoom = roomState;
    }

    return {
      roomId: inviterRoom.roomId,
      inviterId: normalizedInviterId,
      inviteeId: normalizedAcceptorId,
      deviceId: inviterRoom.deviceId,
      gameId: inviterRoom.gameId,
      participants: inviterRoom.participants, // Include all participants
      mode: inviterRoom.mode,
    };
  }

  async cancelInvite(userId: string, data: CancelInvitePayload) {
    // await this.assertIndividualUser(userId);

    const normalizedUserId = this.normalizeId(userId);
    const normalizedInviterId = this.normalizeId(data?.inviterId);

    if (!normalizedUserId) {
      throw new BadRequestException('User ID is required');
    }

    if (!normalizedInviterId) {
      throw new BadRequestException('Inviter ID is required');
    }

    // Find the pending invite where user is the invitee (toUserId) using Array.find()
    const inviteEntry = Array.from(this.pendingInvites.entries()).find(
      ([inviteId, invite]) =>
        invite.fromUserId === normalizedInviterId &&
        invite.toUserId === normalizedUserId &&
        (!data.gameId || invite.gameId === data.gameId),
    );

    const foundInvite = inviteEntry ? inviteEntry[1] : null;
    const foundInviteId = inviteEntry ? inviteEntry[0] : null;

    // If no pending invite found, check active rooms
    if (!foundInvite) {
      // Check if there's an active room using Array.find()
      const roomEntry = Array.from(this.activeRooms.entries()).find(
        ([roomKey, room]) =>
          room.participants.includes(normalizedInviterId) &&
          room.participants.includes(normalizedUserId) &&
          (!data.gameId || room.gameId === data.gameId),
      );

      const foundRoom = roomEntry ? roomEntry[1] : null;
      const foundRoomKey = roomEntry ? roomEntry[0] : null;

      if (foundRoom) {
        // Notify the inviter that the invite was canceled
        const inviterSocket = this.userSockets.get(normalizedInviterId);
        if (inviterSocket) {
          inviterSocket.emit('gameInviteCanceled', {
            inviteeId: normalizedUserId,
            gameId: foundRoom.gameId,
            roomId: foundRoom.roomId,
            canceledAt: new Date().toISOString(),
          });
        }

        // Remove the room
        if (foundRoomKey) {
          this.activeRooms.delete(foundRoomKey);
        }

        return {
          success: true,
          roomId: foundRoom.roomId,
          inviterId: normalizedInviterId,
          inviteeId: normalizedUserId,
          gameId: foundRoom.gameId,
        };
      }

      throw new BadRequestException('No active invite or room found');
    }

    // Verify that the user canceling is the invitee (toUserId), not the inviter
    if (foundInvite.toUserId !== normalizedUserId) {
      throw new BadRequestException('Only the invitee can cancel the invite');
    }

    // Notify the inviter that the invite was canceled
    const inviterSocket = this.userSockets.get(normalizedInviterId);
    if (inviterSocket) {
      inviterSocket.emit('gameInviteCanceled', {
        inviteId: foundInvite.inviteId,
        inviteeId: normalizedUserId,
        gameId: foundInvite.gameId,
        canceledAt: new Date().toISOString(),
      });
    }

    // Remove the pending invite
    if (foundInviteId) {
      this.pendingInvites.delete(foundInviteId);
    }

    return {
      success: true,
      inviteId: foundInvite.inviteId,
      inviterId: normalizedInviterId,
      inviteeId: normalizedUserId,
      gameId: foundInvite.gameId,
    };
  }

  async removeUserFromRoomParticipants(roomId: string, userId: string) {
    // await this.assertIndividualUser(userId);

    const normalizedUserId = this.normalizeId(userId);
    if (!normalizedUserId) {
      throw new BadRequestException('User ID is required');
    }

    // Find the room by roomId
    let foundRoom: ActiveRoom | null = null;
    let foundRoomKey: string | null = null;

    for (const [roomKey, room] of this.activeRooms.entries()) {
      if (room.roomId === roomId) {
        foundRoom = room;
        foundRoomKey = roomKey;
        break;
      }
    }

    if (!foundRoom) {
      throw new BadRequestException('Room not found');
    }

    if (!foundRoom.participants.includes(normalizedUserId)) {
      throw new BadRequestException('User is not in this room');
    }

    // Remove user from participants but keep the room
    foundRoom.participants = foundRoom.participants.filter(
      (p) => p !== normalizedUserId,
    );

    // Update the room in the map
    if (foundRoomKey) {
      this.activeRooms.set(foundRoomKey, foundRoom);
    }

    // Notify remaining participants that the user left
    foundRoom.participants.forEach((participantId) => {
      const participantSocket = this.userSockets.get(participantId);
      if (participantSocket) {
        participantSocket.emit('userLeftRoom', {
          roomId: foundRoom.roomId,
          userId: normalizedUserId,
          leftAt: new Date().toISOString(),
          remainingParticipants: foundRoom.participants,
        });
      }
    });

    return {
      success: true,
      roomId: foundRoom.roomId,
      userId: normalizedUserId,
      remainingParticipants: foundRoom.participants,
      leftAt: new Date().toISOString(),
    };
  }

  async leaveUser(userId: string) {
    // await this.assertIndividualUser(userId);

    const normalizedUserId = this.normalizeId(userId);
    if (!normalizedUserId) {
      throw new BadRequestException('User ID is required');
    }

    // Find the room the user is in
    let foundRoom: ActiveRoom | null = null;
    let foundRoomKey: string | null = null;

    for (const [roomKey, room] of this.activeRooms.entries()) {
      if (room.participants.includes(normalizedUserId)) {
        foundRoom = room;
        foundRoomKey = roomKey;
        break;
      }
    }

    if (!foundRoom) {
      throw new BadRequestException('User is not in any active room');
    }

    // Get the other participant
    const otherParticipant = foundRoom.participants.find(
      (p) => p !== normalizedUserId,
    );

    // Remove the room
    if (foundRoomKey) {
      this.activeRooms.delete(foundRoomKey);
    }

    // Notify the other participant that the user left
    if (otherParticipant) {
      const otherSocket = this.userSockets.get(otherParticipant);
      if (otherSocket) {
        otherSocket.emit('userLeftRoom', {
          roomId: foundRoom.roomId,
          userId: normalizedUserId,
          leftAt: new Date().toISOString(),
        });
      }
    }

    return {
      success: true,
      roomId: foundRoom.roomId,
      userId: normalizedUserId,
      leftAt: new Date().toISOString(),
    };
  }

  async removeUserFromRoom(requesterId: string, targetUserId: string) {
    // await this.assertIndividualUser(requesterId);

    const normalizedRequesterId = this.normalizeId(requesterId);
    const normalizedTargetUserId = this.normalizeId(targetUserId);

    if (!normalizedRequesterId) {
      throw new BadRequestException('Requester ID is required');
    }

    if (!normalizedTargetUserId) {
      throw new BadRequestException('Target user ID is required');
    }

    if (normalizedRequesterId === normalizedTargetUserId) {
      throw new BadRequestException(
        'You cannot remove yourself. Use leaveUser instead.',
      );
    }

    // Find the room the requester is in
    let foundRoom: ActiveRoom | null = null;
    let foundRoomKey: string | null = null;

    for (const [roomKey, room] of this.activeRooms.entries()) {
      if (room.participants.includes(normalizedRequesterId)) {
        foundRoom = room;
        foundRoomKey = roomKey;
        break;
      }
    }

    if (!foundRoom) {
      throw new BadRequestException('You are not in any active room');
    }

    // Check if requester is the room creator (first participant)
    if (foundRoom.participants[0] !== normalizedRequesterId) {
      throw new BadRequestException('Only the room creator can remove users');
    }

    // Check if target user is in the room
    if (!foundRoom.participants.includes(normalizedTargetUserId)) {
      throw new BadRequestException('Target user is not in this room');
    }

    // Remove target user from participants
    foundRoom.participants = foundRoom.participants.filter(
      (p) => p !== normalizedTargetUserId,
    );

    // If no participants left, delete the room
    if (foundRoom.participants.length === 0) {
      if (foundRoomKey) {
        this.activeRooms.delete(foundRoomKey);
      }
    } else {
      // Update the room
      if (foundRoomKey) {
        this.activeRooms.set(foundRoomKey, foundRoom);
      }
    }

    // Notify the removed user
    const targetSocket = this.userSockets.get(normalizedTargetUserId);
    if (targetSocket) {
      targetSocket.emit('userRemovedFromRoom', {
        roomId: foundRoom.roomId,
        removedBy: normalizedRequesterId,
        removedAt: new Date().toISOString(),
      });
    }

    // Notify remaining participants
    foundRoom.participants.forEach((participantId) => {
      const participantSocket = this.userSockets.get(participantId);
      if (participantSocket) {
        participantSocket.emit('userRemovedFromRoomNotification', {
          roomId: foundRoom.roomId,
          removedUserId: normalizedTargetUserId,
          removedBy: normalizedRequesterId,
          remainingParticipants: foundRoom.participants,
          removedAt: new Date().toISOString(),
        });
      }
    });

    return {
      success: true,
      roomId: foundRoom.roomId,
      removedUserId: normalizedTargetUserId,
      removedBy: normalizedRequesterId,
      remainingParticipants: foundRoom.participants,
      removedAt: new Date().toISOString(),
    };
  }

  async updateUserOnlineStatus(userId: string, isOnline: boolean) {
    // await this.assertIndividualUser(userId);

    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    const normalizedUserId = this.normalizeId(userId);
    const updated = await this.userModel
      .findByIdAndUpdate(
        normalizedUserId,
        { $set: { isOnline } },
        { new: true, lean: true },
      )
      .exec();

    if (!updated) {
      throw new NotFoundException('User not found');
    }

    return updated;
  }

  /**
   * Toggle user online status (true -> false, false -> true)
   * Returns the new status after toggling
   */
  async toggleUserOnlineStatus(userId: string) {
    // await this.assertIndividualUser(userId);

    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    const normalizedUserId = this.normalizeId(userId);

    // Get current user status
    const user = await this.userModel.findById(normalizedUserId).lean().exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Toggle the status
    const newStatus = !user.isOnline;

    // Update with new status
    const updated = await this.userModel
      .findByIdAndUpdate(
        normalizedUserId,
        { $set: { isOnline: newStatus } },
        { new: true, lean: true },
      )
      .exec();

    if (!updated) {
      throw new NotFoundException('User not found');
    }

    return updated;
  }

  async getOnlineUsers() {
    const users = await this.userModel
      .find({ isOnline: true, isActive: true, userType: USER_TYPE[0] })
      .select('_id name email profileImage isOnline lastSeen userType')
      .sort({ lastSeen: -1 })
      .lean()
      .exec();

    return users;
  }

  async shearchOnilneUsersName(name: string, userId?: string) {
    if (userId) {
      // await this.assertIndividualUser(userId);
    }

    const trimmedName = name?.trim();
    if (!trimmedName) {
      return [];
    }

    const query: FilterQuery<UserDocument> = {
      name: { $regex: trimmedName, $options: 'i' },
      isActive: true,
      userType: USER_TYPE[0], // Only include Individual users, exclude Organization users
    };

    if (userId) {
      query._id = { $ne: userId };
    }

    const users = await this.userModel
      .find(query)
      .select('_id name email profileImage isOnline lastSeen')
      .sort({ isOnline: -1, name: 1 })
      .lean()
      .exec();

    return users.filter((user) => user?.name);
  }

  async getRandomDeck() {
    const query: FilterQuery<DeckDocument> = {
      isPublic: true,
      status: 'approve',
    };

    // Get count of matching decks
    const count = await this.deckModel.countDocuments(query).exec();

    if (count === 0) {
      throw new NotFoundException('No public approved decks available');
    }

    // Get random skip value
    const randomSkip = Math.floor(Math.random() * count);

    // Get one random deck
    const randomDeck = await this.deckModel
      .findOne(query)
      .skip(randomSkip)
      .lean()
      .exec();

    if (!randomDeck) {
      throw new NotFoundException('Failed to retrieve random deck');
    }

    return randomDeck;
  }

  async createMultiplayerGame(
    userId: string,
    mode: 'DUEL' | 'BRAWL',
    topicType?: 'random' | 'selected',
    deckId?: string,
    roomId?: string,
    participants?: string[],
    gameMode?: 'Regular' | 'Knockout',
    member?: number,
  ): Promise<{
    gameId: string;
    deckId: string;
    deckName: string;
    topicId: string;
    subTopicId: string;
  }> {
    // await this.assertIndividualUser(userId);

    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    if (!mode || (mode !== 'DUEL' && mode !== 'BRAWL')) {
      throw new BadRequestException('mode must be either "DUEL" or "BRAWL"');
    }

    // Validate topicType and deckId
    if (topicType === 'selected') {
      if (!deckId) {
        throw new BadRequestException(
          'deckId is required when topicType is "selected"',
        );
      }
    } else if (topicType === 'random') {
      // deckId is not required for random
    } else {
      // Default to random if not specified
      topicType = 'random';
    }

    let deck: LeanDeck | null = null;

    // Get deck based on topicType
    if (topicType === 'selected' && deckId) {
      const normalizedDeckId = this.normalizeId(deckId);
      if (!normalizedDeckId) {
        throw new BadRequestException('Invalid deckId');
      }

      const deckResult = await this.deckModel
        .findById(normalizedDeckId)
        .lean()
        .exec();
      deck = deckResult as unknown as LeanDeck | null;
      if (!deck) {
        throw new NotFoundException('Deck not found');
      }

      // Verify deck is public and approved (or belongs to user)
      const normalizedUserId = this.normalizeId(userId);
      const normalizedDeckUserId = this.normalizeId(deck.userId);
      if (
        !deck.isPublic ||
        deck.status !== 'approve' ||
        normalizedDeckUserId !== normalizedUserId
      ) {
        // Allow if deck belongs to user, otherwise check if public and approved
        if (normalizedDeckUserId !== normalizedUserId) {
          if (!deck.isPublic || deck.status !== 'approve') {
            throw new BadRequestException(
              'Deck is not available. It must be public and approved, or belong to you.',
            );
          }
        }
      }
    } else {
      // Get random deck
      const deckResult = await this.getRandomDeck();
      deck = deckResult as unknown as LeanDeck;
    }

    if (!deck) {
      throw new NotFoundException('Failed to get deck');
    }

    // Get topics from deck
    const topicIds = (deck.contentIds || []).filter((id) => id);
    if (topicIds.length === 0) {
      throw new BadRequestException('Deck has no topics');
    }

    // Get all topics
    const topics = await this.topicModel
      .find({ _id: { $in: topicIds } })
      .lean()
      .exec();

    if (topics.length === 0) {
      throw new BadRequestException('No topics found in deck');
    }

    // For random selection: first pick a random topic, then pick a random subtopic from that topic
    let selectedSubTopicId: string | null = null;
    let selectedTopicId: string | null = null;

    if (topicType === 'random') {
      // Filter topics that have subtopics
      const topicsWithSubTopics = topics.filter(
        (topic) =>
          topic.subTopics &&
          Array.isArray(topic.subTopics) &&
          topic.subTopics.length > 0,
      );

      if (topicsWithSubTopics.length === 0) {
        throw new BadRequestException('Deck has no topics with subtopics');
      }

      // Pick a random topic from topics that have subtopics
      const randomTopicIndex = Math.floor(
        Math.random() * topicsWithSubTopics.length,
      );
      const selectedTopic = topicsWithSubTopics[randomTopicIndex];
      selectedTopicId = this.normalizeId(selectedTopic._id);

      // Pick a random subtopic from the selected topic
      const randomSubTopicIndex = Math.floor(
        Math.random() * selectedTopic.subTopics.length,
      );
      selectedSubTopicId = this.normalizeId(
        selectedTopic.subTopics[randomSubTopicIndex],
      );
    } else {
      // For selected deck, get all subtopics from all topics and pick one randomly
      const allSubTopicIds: string[] = [];
      for (const topic of topics) {
        if (topic.subTopics && Array.isArray(topic.subTopics)) {
          allSubTopicIds.push(...topic.subTopics);
        }
      }

      if (allSubTopicIds.length === 0) {
        throw new BadRequestException('Deck has no subtopics');
      }

      // Select a random subtopic
      const randomIndex = Math.floor(Math.random() * allSubTopicIds.length);
      selectedSubTopicId = this.normalizeId(allSubTopicIds[randomIndex]);

      // Find which topic this subtopic belongs to
      for (const topic of topics) {
        if (
          topic.subTopics &&
          Array.isArray(topic.subTopics) &&
          topic.subTopics.some(
            (stId) => this.normalizeId(stId) === selectedSubTopicId,
          )
        ) {
          selectedTopicId = this.normalizeId(topic._id);
          break;
        }
      }
    }

    if (!selectedSubTopicId) {
      throw new BadRequestException('Failed to select subtopic');
    }

    // Verify subtopic exists
    const subTopic = await this.subTopicModel.findById(selectedSubTopicId);
    if (!subTopic) {
      throw new NotFoundException('Selected subtopic not found');
    }

    // Create game
    const gameId = roomId || randomUUID();
    const normalizedDeckId = this.normalizeId(deck._id);
    const gamePlayers = participants || [userId];

    await this.gameModel.create({
      gameId,
      type: 'multiplayer',
      gameMode: mode.toLowerCase() as 'duel' | 'brawl',
      players: gamePlayers,
      subTopicId: selectedSubTopicId,
      difficulty: 'medium', // Default difficulty, can be made configurable
      deckSelectionMethod: topicType,
      selectedDeckId: normalizedDeckId || undefined,
      questions: [], // Questions will be generated when game starts
      scores: {},
      isCompleted: false,
      gameStarted: false,
      acceptedPlayers: gamePlayers,
      metadata: {
        roomId: roomId || gameId,
        gameMode: gameMode || undefined,
        member: member || undefined,
      },
    });

    return {
      gameId,
      deckId: normalizedDeckId || '',
      deckName: deck.name || '',
      topicId: selectedTopicId || '',
      subTopicId: selectedSubTopicId,
    };
  }

  async askQuestion(
    subTopicId: string,
    question: string,
    userId?: string,
    deviceId?: string,
  ) {
    if (userId) {
      // await this.assertIndividualUser(userId);
    }

    if (!subTopicId) {
      throw new BadRequestException('subTopicId is required');
    }
    if (!question || !question.trim()) {
      throw new BadRequestException('question is required');
    }

    const normalizedSubTopicId = this.normalizeId(subTopicId);
    if (!normalizedSubTopicId) {
      throw new BadRequestException('Invalid subtopic id');
    }

    // Fetch subtopic
    const subTopic = await this.subTopicModel.findById(normalizedSubTopicId);
    if (!subTopic) {
      throw new NotFoundException('Subtopic not found');
    }

    // Generate answer using AI
    const answer = await this.aiService.answerQuestion(
      normalizedSubTopicId,
      question.trim(),
    );

    // Store question and answer in subtopic's questionsAsked array
    const questionEntry = {
      question: question.trim(),
      answer,
      userId: userId ? this.normalizeId(userId) : undefined,
      deviceId: deviceId || undefined,
      askedAt: new Date(),
      source: 'ai' as const,
    };

    await this.subTopicModel.findByIdAndUpdate(
      normalizedSubTopicId,
      {
        $push: { questionsAsked: questionEntry },
      },
      { new: true },
    );

    return {
      question: question.trim(),
      answer,
      subTopicId: normalizedSubTopicId,
      askedAt: questionEntry.askedAt,
    };
  }

  async getMoreDetails(subTopicId: string, userId?: string, deviceId?: string) {
    if (userId) {
      // await this.assertIndividualUser(userId);
    }

    if (!subTopicId) {
      throw new BadRequestException('subTopicId is required');
    }

    const normalizedSubTopicId = this.normalizeId(subTopicId);
    if (!normalizedSubTopicId) {
      throw new BadRequestException('Invalid subtopic id');
    }

    // Fetch subtopic
    const subTopic = await this.subTopicModel.findById(normalizedSubTopicId);
    if (!subTopic) {
      throw new NotFoundException('Subtopic not found');
    }

    // Use subtopic description for AI generation
    const description = subTopic.description || subTopic.title || '';

    // Generate more details using AI
    const result = await this.aiService.moreDetails(description);

    // Store moreDetails data in database
    const moreDetailsEntry = {
      userId: userId ? this.normalizeId(userId) : undefined,
      deviceId: deviceId || undefined,
      answer: result.answer,
      requestedAt: new Date(),
    };

    await this.subTopicModel.findByIdAndUpdate(
      normalizedSubTopicId,
      {
        $push: { moreDetailsRequests: moreDetailsEntry },
      },
      { new: true },
    );

    return {
      subTopicId: normalizedSubTopicId,
      ...result,
      requestedAt: moreDetailsEntry.requestedAt,
    };
  }

  /**
   * Get user's level and badge information
   */
  async getUserLevelAndBadge(userId: string) {
    // await this.assertIndividualUser(userId);

    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    const normalizedUserId = this.normalizeId(userId);
    if (!normalizedUserId) {
      throw new BadRequestException('Invalid user ID');
    }

    // Get user's game progress
    const progress = await this.gameProgressModel
      .findOne({ userId: normalizedUserId })
      .lean()
      .exec();

    // If no progress exists, return default values
    if (!progress) {
      return {
        level: 1,
        badge: 'Spark',
        points: 0,
        coins: 0,
        badges: [],
      };
    }

    // Calculate current badge and level based on points
    const points = progress.points || 0;
    const badge = this.calculateBadge(points);
    const level = this.calculateLevel(points);

    // Calculate all earned badges up to current level
    const allEarnedBadges = this.calculateAllEarnedBadges(points);

    return {
      level,
      badge,
      points,
      coins: progress.coins || 0,
      badges: allEarnedBadges.length > 0 ? allEarnedBadges : ['Spark'],
    };
  }

  /**
   * Get daily streak information for a user
   * Returns currentDailyStreak, longestDailyStreak, and dailyStreakIcons (7-day array)
   */
  async getDailyStreak(userId: string) {
    // await this.assertIndividualUser(userId);

    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    const normalizedUserId = this.normalizeId(userId);
    if (!normalizedUserId) {
      throw new BadRequestException('Invalid user ID');
    }

    const progress = await this.gameProgressModel
      .findOne({ userId: normalizedUserId })
      .lean()
      .exec();

    if (!progress) {
      // Return default with empty string for today and cross for past 6 days
      const defaultIcons: string[] = [];
      const today = new Date();
      const todayStart = new Date(today);
      todayStart.setHours(0, 0, 0, 0);
      const startOfWeek = this.getStartOfWeek(today);
      const todayDateString = this.getDateString(today);
      for (let i = 0; i < 7; i++) {
        const date = new Date(startOfWeek);
        date.setDate(startOfWeek.getDate() + i);
        const dateString = this.getDateString(date);
        const isToday = dateString === todayDateString;
        const isFuture = date > todayStart;
        defaultIcons.push(isToday || isFuture ? '' : 'cross');
      }

      return {
        currentDailyStreak: 0,
        longestDailyStreak: 0,
        dailyStreakIcons: defaultIcons,
        lastGamePlayDate: null,
      };
    }

    // Always update icons based on current dailyGamesCount to ensure today is handled correctly
    const dailyGamesCount = progress.dailyGamesCount || {};
    const startOfWeek = this.getStartOfWeek(new Date());
    let dailyStreakIcons = this.update7DayIcons(dailyGamesCount);
    const dailyStreakWeek = this.buildWeeklyIconMeta(
      startOfWeek,
      dailyStreakIcons,
    );

    // If icons array is not 7 elements, fill with empty strings for today and cross for past days
    if (dailyStreakIcons.length !== 7) {
      const today = new Date();
      const todayStart = new Date(today);
      todayStart.setHours(0, 0, 0, 0);
      const startOfWeek = this.getStartOfWeek(today);
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
      // rebuild meta after fixing length
      dailyStreakWeek.length = 0;
      dailyStreakWeek.push(
        ...this.buildWeeklyIconMeta(startOfWeek, dailyStreakIcons),
      );
    }

    // Update in database to keep it in sync
    await this.gameProgressModel.findOneAndUpdate(
      { userId: normalizedUserId },
      { $set: { dailyStreakIcons } },
    );

    return {
      currentDailyStreak: progress.currentDailyStreak || 0,
      longestDailyStreak: progress.longestDailyStreak || 0,
      dailyStreakIcons: dailyStreakIcons,
      dailyStreakWeek,
      lastGamePlayDate: progress.lastGamePlayDate || null,
    };
  }

  /**
   * Get leaderboard - all users sorted by highest points
   * Optional: filter by level name (e.g., Awakened, Trailblazers, Legends)
   * Returns simplified response with pagination.
   */
  private getLevelName(level: number): string {
    // Map numeric levels (1-20) to named tiers
    const levelNames = [
      'Awakened', // 1
      'Initiators',
      'Pathfinders',
      'Builders',
      'Achievers',
      'Catalysts',
      'Trailblazers',
      'Luminaries',
      'Visionaries',
      'Conquerors',
      'Innovators',
      'Mavericks',
      'Ascendants',
      'Navigators',
      'Transformers',
      'Champions',
      'Guardians',
      'Architects',
      'Vanguards',
      'Legends', // 20
    ];

    const idx = Math.min(Math.max(level, 1), 20) - 1;
    return levelNames[idx] ?? 'Awakened';
  }

  async getLeaderboard(
    userId: string,
    page: number = 1,
    limit: number = 10,
    levelName?: string,
  ) {
    // await this.assertIndividualUser(userId);

    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    const normalizedUserId = this.normalizeId(userId);
    if (!normalizedUserId) {
      throw new BadRequestException('Invalid user ID');
    }

    // Validate pagination parameters
    const pageNumber = Math.max(1, Math.floor(page));
    const limitNumber = Math.max(1, Math.min(100, Math.floor(limit))); // Max 100 per page
    const skip = (pageNumber - 1) * limitNumber;

    // Get authenticated user's game progress to determine their level
    const authenticatedUserProgress = await this.gameProgressModel
      .findOne({ userId: normalizedUserId })
      .lean()
      .exec();

    const authenticatedUserPoints = authenticatedUserProgress?.points || 0;
    const authenticatedUserLevel = this.calculateLevel(authenticatedUserPoints);

    // Allow filtering by level name (e.g. "Awakened") OR numeric level (e.g. "1" or 1)
    // If no levelName is provided, use authenticated user's level as default filter
    const normalizedLevelName =
      levelName?.toString().trim().toLowerCase() || null;
    const levelNumberFilter = normalizedLevelName
      ? Number.parseInt(normalizedLevelName, 10)
      : null;
    const hasLevelNumberFilter =
      levelNumberFilter !== null && !Number.isNaN(levelNumberFilter);

    // If no levelName is provided, use authenticated user's level as the filter
    const defaultLevelFilter = normalizedLevelName
      ? null
      : authenticatedUserLevel;

    // Get ALL game progress records from gameprogresses table with userId
    // This ensures we get all users from the gameprogresses table
    const allProgress = await this.gameProgressModel
      .find({ userId: { $exists: true, $ne: null } })
      .lean()
      .exec();

    // Group progress by userId to handle duplicates (use the one with highest points)
    // This ensures each user appears only once with their best progress
    const progressMap = new Map<string, LeanGameProgress>();
    allProgress.forEach((progress) => {
      const progressUserId = this.normalizeId(progress.userId);
      if (!progressUserId) return;

      const existing = progressMap.get(progressUserId);
      const currentPoints = Number(progress.points) || 0;

      // If no existing record or current has more points, use current
      if (!existing || currentPoints > (Number(existing.points) || 0)) {
        progressMap.set(
          progressUserId,
          progress as unknown as LeanGameProgress,
        );
      }
    });

    // Get all unique user IDs from gameprogresses table
    const userIds = Array.from(progressMap.keys());

    if (userIds.length === 0) {
      return {
        data: [],
        pagination: {
          page: pageNumber,
          limit: limitNumber,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPrevPage: false,
        },
      };
    }

    // Get user details for ALL users from gameprogresses table
    // Filter by userType = 'individual' to exclude Organization users
    const users = await this.userModel
      .find({
        _id: { $in: userIds },
        userType: 'individual', // Only include Individual users, exclude Organization users
      })
      .select('_id name email profileImage isOnline userType createdAt')
      .lean()
      .exec();

    // Create a map of userId to user details (only Individual users)
    // Since we filtered by userType = 'individual' in the query, all users here are Individual
    type LeanUserLeaderboard = {
      _id: Types.ObjectId;
      name?: string | null;
      email: string;
      profileImage?: string;
      isOnline?: boolean;
      userType?: string;
      createdAt?: Date | string;
    };
    const userMap = new Map<string, LeanUserLeaderboard>();
    users.forEach((user) => {
      const progressUserId = this.normalizeId(user._id);
      if (progressUserId) {
        userMap.set(progressUserId, user as LeanUserLeaderboard);
      }
    });

    // Build leaderboard entries for ALL Individual users from gameprogresses table
    // Calculate level for each user based on their points
    // Only Individual users are included (Organization users are excluded via query filter)
    const baseLeaderboardEntries = Array.from(progressMap.entries())
      .map(([progressUserId, progress]) => {
        const user = userMap.get(progressUserId);

        // Skip if user is not found in userMap (means they're Organization type, excluded by query)
        if (!user) {
          return null;
        }

        const userName = user.name || 'Unknown User';
        const userEmail = user.email || '';
        const userProfileImage = user.profileImage || null;
        const userIsOnline = !!user.isOnline;
        const userCreatedAt = user.createdAt || new Date();

        // Calculate level based on points from gameprogresses table
        const points = Number(progress.points) || 0;
        const userLevel = this.calculateLevel(points);
        const levelNameForUser = this.getLevelName(userLevel);

        return {
          userId: progressUserId,
          name: userName,
          email: userEmail,
          level: userLevel,
          levelName: levelNameForUser,
          points,
          profileImage: userProfileImage,
          isOnline: userIsOnline,
          createdAt: userCreatedAt, // Include createdAt for tie-breaking
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    // Compute global ranks across all levels (higher points first; tie-break by createdAt then name)
    const globalRankMap = new Map<string, number>();
    const globallySorted = [...baseLeaderboardEntries].sort((a, b) => {
      if (b.points !== a.points) {
        return b.points - a.points;
      }
      const aCreatedAt =
        a.createdAt &&
        (a.createdAt instanceof Date ||
          typeof a.createdAt === 'string' ||
          typeof a.createdAt === 'number')
          ? new Date(a.createdAt).getTime()
          : 0;
      const bCreatedAt =
        b.createdAt &&
        (b.createdAt instanceof Date ||
          typeof b.createdAt === 'string' ||
          typeof b.createdAt === 'number')
          ? new Date(b.createdAt).getTime()
          : 0;
      if (aCreatedAt !== bCreatedAt) {
        return aCreatedAt - bCreatedAt; // earlier date wins
      }
      return (a.name || '').localeCompare(b.name || '');
    });
    globallySorted.forEach((entry, index) => {
      globalRankMap.set(entry.userId, index + 1);
    });

    // Attach globalRank to entries
    let allLeaderboardEntries: BaseLeaderboardEntry[] = baseLeaderboardEntries
      .map(
        (entry): BaseLeaderboardEntry => ({
          ...entry,
          globalRank: globalRankMap.get(entry.userId) || null,
        }),
      )
      .filter((entry) => {
        // Apply level filter if provided
        if (hasLevelNumberFilter) {
          // Clamp level filter between 1 and 20
          const targetLevel = Math.min(Math.max(levelNumberFilter, 1), 20);
          return entry.level === targetLevel;
        }

        // If levelName is provided, filter by levelName
        if (normalizedLevelName) {
          const entryLevelName = entry.levelName?.toLowerCase().trim() || '';
          // Accept exact match or partial match to be resilient to minor spelling/casing differences
          return (
            entryLevelName === normalizedLevelName ||
            entryLevelName.includes(normalizedLevelName)
          );
        }

        // If no levelName is provided, filter by authenticated user's level
        if (defaultLevelFilter !== null) {
          return entry.level === defaultLevelFilter;
        }

        // Fallback: include all levels (should not reach here)
        return true;
      })
      .sort((a, b) => {
        // Sort by level descending first, then by points descending, then by createdAt ascending (earlier = better rank), then by name ascending
        if (b.level !== a.level) {
          return b.level - a.level;
        }
        if (b.points !== a.points) {
          return b.points - a.points;
        }
        // If points are equal, earlier created user gets better rank
        const aCreatedAt =
          a.createdAt &&
          (a.createdAt instanceof Date ||
            typeof a.createdAt === 'string' ||
            typeof a.createdAt === 'number')
            ? new Date(a.createdAt).getTime()
            : 0;
        const bCreatedAt =
          b.createdAt &&
          (b.createdAt instanceof Date ||
            typeof b.createdAt === 'string' ||
            typeof b.createdAt === 'number')
            ? new Date(b.createdAt).getTime()
            : 0;
        if (aCreatedAt !== bCreatedAt) {
          return aCreatedAt - bCreatedAt; // Ascending: earlier date = smaller number = better rank
        }
        return (a.name || '').localeCompare(b.name || '');
      });

    // Group entries by level and assign ranks within each level
    type LeaderboardEntry = {
      userId: string;
      name: string;
      email: string;
      level: number;
      levelName: string;
      points: number;
      profileImage: string | null;
      isOnline: boolean;
      createdAt?: Date | string;
      rank?: number;
      globalRank?: number | null;
    };

    type BaseLeaderboardEntry = {
      userId: string;
      name: string;
      email: string;
      level: number;
      levelName: string;
      points: number;
      profileImage: string | null;
      isOnline: boolean;
      createdAt?: Date | string;
      globalRank: number | null;
    };

    const entriesByLevel = new Map<number, LeaderboardEntry[]>();

    // Determine target level if filter is applied
    let targetLevelForFilter: number | null = null;
    if (hasLevelNumberFilter) {
      targetLevelForFilter = Math.min(Math.max(levelNumberFilter, 1), 20);
    } else if (normalizedLevelName) {
      // Find the level number for the given levelName
      // We need to check which level matches the levelName
      const matchingEntry = allLeaderboardEntries.find(
        (entry) =>
          entry.levelName?.toLowerCase().trim() === normalizedLevelName ||
          entry.levelName?.toLowerCase().trim().includes(normalizedLevelName),
      );
      if (matchingEntry) {
        targetLevelForFilter = matchingEntry.level;
      }
    } else if (defaultLevelFilter !== null) {
      // If no levelName is provided, use authenticated user's level
      targetLevelForFilter = defaultLevelFilter;
    }

    // Group all entries by their level
    allLeaderboardEntries.forEach((entry) => {
      const level = entry.level;

      // If level filter is applied, only process entries from that level
      if (targetLevelForFilter !== null && level !== targetLevelForFilter) {
        return; // Skip entries from other levels
      }

      if (!entriesByLevel.has(level)) {
        entriesByLevel.set(level, []);
      }
      // Cast entry to LeaderboardEntry type
      entriesByLevel.get(level)!.push(entry as LeaderboardEntry);
    });

    // Assign ranks within each level and flatten
    const rankedEntries: LeaderboardEntry[] = [];

    // If level filter is applied, only process that level
    // Otherwise, process all levels sorted descending
    const levelsToProcess =
      targetLevelForFilter !== null
        ? [targetLevelForFilter] // Only the filtered level
        : Array.from(entriesByLevel.keys()).sort((a, b) => b - a); // All levels sorted descending

    levelsToProcess.forEach((level) => {
      let levelEntries = entriesByLevel.get(level);
      if (!levelEntries || levelEntries.length === 0) {
        return;
      }

      // Sort entries within this level: by points descending, then by createdAt ascending (earlier = better rank), then by name
      levelEntries = levelEntries.sort((a, b) => {
        if (b.points !== a.points) {
          return b.points - a.points;
        }
        // If points are equal, earlier created user gets better rank
        const aCreatedAt =
          a.createdAt &&
          (a.createdAt instanceof Date ||
            typeof a.createdAt === 'string' ||
            typeof a.createdAt === 'number')
            ? new Date(a.createdAt).getTime()
            : 0;
        const bCreatedAt =
          b.createdAt &&
          (b.createdAt instanceof Date ||
            typeof b.createdAt === 'string' ||
            typeof b.createdAt === 'number')
            ? new Date(b.createdAt).getTime()
            : 0;
        if (aCreatedAt !== bCreatedAt) {
          return aCreatedAt - bCreatedAt; // Ascending: earlier date = smaller number = better rank
        }
        return (a.name || '').localeCompare(b.name || '');
      });

      // Assign ranks starting from 1 for each level
      levelEntries.forEach((entry, index) => {
        rankedEntries.push({
          ...entry,
          rank: index + 1, // Rank within level (1-based)
        });
      });
    });

    // Update allLeaderboardEntries with ranked entries
    allLeaderboardEntries = rankedEntries as BaseLeaderboardEntry[];

    // Apply pagination
    const total = allLeaderboardEntries.length;
    const totalPages = Math.ceil(total / limitNumber);
    const paginatedData = allLeaderboardEntries.slice(skip, skip + limitNumber);

    return {
      data: paginatedData,
      pagination: {
        page: pageNumber,
        limit: limitNumber,
        total,
        totalPages,
        hasNextPage: pageNumber < totalPages,
        hasPrevPage: pageNumber > 1,
      },
    };
  }

  async moveTopics(topicIds: string[], deckId: string, userId: string) {
    // await this.assertIndividualUser(userId);

    // Validate inputs
    if (!topicIds || !Array.isArray(topicIds) || topicIds.length === 0) {
      throw new BadRequestException(
        'topicIds array is required and must not be empty',
      );
    }

    if (!deckId) {
      throw new BadRequestException('deckId is required');
    }

    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    // Normalize IDs
    const normalizedUserId = this.normalizeId(userId);
    if (!normalizedUserId) {
      throw new BadRequestException('Invalid userId');
    }

    // Normalize topic IDs
    const normalizedTopicIds = topicIds
      .map((id) => this.normalizeId(id))
      .filter((id): id is string => !!id);

    if (normalizedTopicIds.length === 0) {
      throw new BadRequestException('No valid topic IDs provided');
    }

    // Normalize deck ID
    const normalizedDeckId = this.normalizeId(deckId);
    if (!normalizedDeckId) {
      throw new BadRequestException('Invalid deckId');
    }

    // Verify all topics exist
    const topics = await this.topicModel
      .find({ _id: { $in: normalizedTopicIds } })
      .exec();

    if (topics.length !== normalizedTopicIds.length) {
      const foundIds = topics.map((t) => this.normalizeId(t._id));
      const missingIds = normalizedTopicIds.filter(
        (id) => !foundIds.includes(id),
      );
      throw new NotFoundException(
        `Some topics not found: ${missingIds.join(', ')}`,
      );
    }

    // Verify destination deck exists
    const destinationDeck = await this.deckModel.findById(normalizedDeckId);
    if (!destinationDeck) {
      throw new NotFoundException('Destination deck not found');
    }

    // Find all decks that contain any of these topics
    const decksWithTopics = await this.deckModel
      .find({
        contentIds: { $in: normalizedTopicIds },
      })
      .exec();

    // Remove topic IDs from old decks' contentIds
    const decksToUpdate = decksWithTopics
      .filter((d) => this.normalizeId(d._id) !== normalizedDeckId)
      .map((oldDeck) => {
        const updatedContentIds = oldDeck.contentIds.filter(
          (id) => !normalizedTopicIds.includes(this.normalizeId(id) || ''),
        );
        oldDeck.contentIds = updatedContentIds;
        return oldDeck;
      });

    // Bulk update all decks at once
    await Promise.all(decksToUpdate.map((deck) => deck.save()));

    // Add topic IDs to destination deck's contentIds (avoid duplicates)
    const existingContentIds = (destinationDeck.contentIds || []).map((id) =>
      this.normalizeId(id),
    );
    const newTopicIds = normalizedTopicIds.filter(
      (id) => !existingContentIds.includes(id),
    );

    if (newTopicIds.length > 0) {
      destinationDeck.contentIds.push(...newTopicIds);
      await destinationDeck.save();
    }

    // Get subtopics for each topic (they're automatically moved since they reference topicId)
    const allSubTopicIds: string[] = [];
    for (const topic of topics) {
      if (topic.subTopics && Array.isArray(topic.subTopics)) {
        allSubTopicIds.push(...topic.subTopics);
      }
    }

    return {
      message: 'Topics moved successfully',
      movedTopics: normalizedTopicIds.length,
      movedSubTopics: allSubTopicIds.length,
      destinationDeckId: normalizedDeckId,
      topicIds: normalizedTopicIds,
      subTopicIds: allSubTopicIds,
    };
  }

  /**
   * Permanently delete topics (and their subtopics) from a deck.
   * Removes the topic IDs from the deck's contentIds and deletes topic + subtopic documents.
   */
  async deleteTopics(
    deckId: string,
    topicIds: string[],
    userId: string,
  ): Promise<{
    deletedTopics: number;
    deletedSubTopics: number;
    deckId: string;
    topicIds: string[];
  }> {
    // await this.assertIndividualUser(userId);

    // Validate inputs
    if (!deckId) {
      throw new BadRequestException('deckId is required');
    }
    if (!userId) {
      throw new BadRequestException('userId is required');
    }
    if (!topicIds || !Array.isArray(topicIds) || topicIds.length === 0) {
      throw new BadRequestException(
        'topicIds array is required and must not be empty',
      );
    }

    const normalizedDeckId = this.normalizeId(deckId);
    const normalizedUserId = this.normalizeId(userId);
    if (!normalizedDeckId) {
      throw new BadRequestException('Invalid deckId');
    }
    if (!normalizedUserId) {
      throw new BadRequestException('Invalid userId');
    }

    // Normalize topic IDs
    const normalizedTopicIds = topicIds
      .map((id) => this.normalizeId(id))
      .filter((id): id is string => !!id);

    if (normalizedTopicIds.length === 0) {
      throw new BadRequestException('No valid topic IDs provided');
    }

    // Fetch deck
    const deck = await this.deckModel.findById(normalizedDeckId);
    if (!deck) {
      throw new NotFoundException('Deck not found');
    }

    // Ensure all requested topics belong to the deck
    const deckTopicIds = (deck.contentIds || [])
      .map((id) => this.normalizeId(id))
      .filter((id): id is string => !!id);
    const missingInDeck = normalizedTopicIds.filter(
      (id) => !deckTopicIds.includes(id),
    );
    if (missingInDeck.length > 0) {
      throw new BadRequestException(
        `Some topics are not part of this deck: ${missingInDeck.join(', ')}`,
      );
    }

    // Count subtopics to report
    const subTopicsToDelete = await this.subTopicModel
      .find({ topicId: { $in: normalizedTopicIds } })
      .select('_id')
      .lean()
      .exec();

    // Delete subtopics first
    const subTopicDeleteResult = await this.subTopicModel.deleteMany({
      topicId: { $in: normalizedTopicIds },
    });

    // Delete topics
    const topicDeleteResult = await this.topicModel.deleteMany({
      _id: { $in: normalizedTopicIds },
    });

    // Remove topic IDs from the deck's contentIds
    deck.contentIds = deck.contentIds.filter((id) => {
      const normalizedId = this.normalizeId(id);
      return normalizedId ? !normalizedTopicIds.includes(normalizedId) : false;
    });
    await deck.save();

    return {
      deletedTopics: topicDeleteResult.deletedCount || 0,
      deletedSubTopics:
        subTopicDeleteResult.deletedCount || subTopicsToDelete.length,
      deckId: normalizedDeckId,
      topicIds: normalizedTopicIds,
    };
  }

  /**
   * Delete a deck along with all its topics and subtopics
   * Only the deck owner (userId) can delete the deck
   */
  async deleteDeck(
    deckId: string,
    userId: string,
  ): Promise<{
    success: boolean;
    deletedDeck: string;
    deletedTopics: number;
    deletedSubTopics: number;
    message: string;
  }> {
    // await this.assertIndividualUser(userId);

    // Validate inputs
    if (!deckId) {
      throw new BadRequestException('deckId is required');
    }
    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    const normalizedDeckId = this.normalizeId(deckId);
    const normalizedUserId = this.normalizeId(userId);

    if (!normalizedDeckId) {
      throw new BadRequestException('Invalid deckId');
    }
    if (!normalizedUserId) {
      throw new BadRequestException('Invalid userId');
    }

    // Fetch deck
    const deck = await this.deckModel.findById(normalizedDeckId);
    if (!deck) {
      throw new NotFoundException('Deck not found');
    }

    // Verify that the deck belongs to the user
    const deckOwnerId = this.normalizeId(deck.userId);
    if (deckOwnerId !== normalizedUserId) {
      throw new BadRequestException('You can only delete decks you created');
    }

    // Get all topic IDs from the deck
    const topicIds = (deck.contentIds || [])
      .map((id) => this.normalizeId(id))
      .filter((id): id is string => !!id);

    let deletedTopicsCount = 0;
    let deletedSubTopicsCount = 0;

    // If deck has topics, delete their subtopics and then the topics
    if (topicIds.length > 0) {
      // Count subtopics to report
      const subTopicsToDelete = await this.subTopicModel
        .find({ topicId: { $in: topicIds } })
        .select('_id')
        .lean()
        .exec();

      // Delete subtopics first
      const subTopicDeleteResult = await this.subTopicModel.deleteMany({
        topicId: { $in: topicIds },
      });

      // Delete topics
      const topicDeleteResult = await this.topicModel.deleteMany({
        _id: { $in: topicIds },
      });

      deletedTopicsCount = topicDeleteResult.deletedCount || 0;
      deletedSubTopicsCount =
        subTopicDeleteResult.deletedCount || subTopicsToDelete.length;
    }

    // Finally, delete the deck
    await this.deckModel.findByIdAndDelete(normalizedDeckId);

    return {
      success: true,
      deletedDeck: normalizedDeckId,
      deletedTopics: deletedTopicsCount,
      deletedSubTopics: deletedSubTopicsCount,
      message: 'Deck deleted successfully along with all topics and subtopics',
    };
  }

  /**
   * Get deck by ID with all topics (without subtopics)
   * Returns complete deck data including all topics but without subtopics populated
   * Supports pagination for topics
   */
  async getDeckById(deckId: string, page: number = 1, limit: number = 10) {
    if (!deckId) {
      throw new BadRequestException('deckId is required');
    }

    const normalizedDeckId = this.normalizeId(deckId);
    if (!normalizedDeckId) {
      throw new BadRequestException('Invalid deckId');
    }

    // Validate pagination parameters
    const pageNumber = Math.max(1, Math.floor(page));
    const limitNumber = Math.max(1, Math.min(100, Math.floor(limit))); // Max 100 per page
    const skip = (pageNumber - 1) * limitNumber;

    // Get deck
    const deck = await this.deckModel.findById(normalizedDeckId).lean().exec();
    if (!deck) {
      throw new NotFoundException('Deck not found');
    }

    // Get all topics from deck's contentIds
    const topicIds = (deck.contentIds || [])
      .map((id) => this.normalizeId(id))
      .filter((id): id is string => !!id);

    if (topicIds.length === 0) {
      return {
        ...deck,
        topics: [],
        pagination: {
          page: pageNumber,
          limit: limitNumber,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPrevPage: false,
        },
      };
    }

    // Get all topics (without populating subtopics)
    const topics = await this.topicModel
      .find({ _id: { $in: topicIds } })
      .lean()
      .exec();

    // Return topics without subtopics populated
    // Remove subTopics array from each topic
    const topicsWithoutSubTopics = topics.map((topic) => {
      const { subTopics, ...topicWithoutSubTopics } = topic;
      return topicWithoutSubTopics;
    });

    // Apply pagination
    const total = topicsWithoutSubTopics.length;
    const totalPages = Math.ceil(total / limitNumber);
    const paginatedTopics = topicsWithoutSubTopics.slice(
      skip,
      skip + limitNumber,
    );

    return {
      ...deck,
      topics: paginatedTopics,
      pagination: {
        page: pageNumber,
        limit: limitNumber,
        total,
        totalPages,
        hasNextPage: pageNumber < totalPages,
        hasPrevPage: pageNumber > 1,
      },
    };
  }

  /**
   * Get topic by ID with all subtopics populated
   * Returns complete topic data including all subtopics
   * If userId is provided, filters userPercentages to show only the current user's percentage
   */
  async getTopicById(topicId: string, userId?: string) {
    if (!topicId) {
      throw new BadRequestException('topicId is required');
    }

    const normalizedTopicId = this.normalizeId(topicId);
    if (!normalizedTopicId) {
      throw new BadRequestException('Invalid topicId');
    }

    // Get topic
    const topic = await this.topicModel
      .findById(normalizedTopicId)
      .lean()
      .exec();
    if (!topic) {
      throw new NotFoundException('Topic not found');
    }

    // Get all subtopics for this topic
    const subTopicIds = (topic.subTopics || [])
      .map((id) => this.normalizeId(id))
      .filter((id): id is string => !!id);

    if (subTopicIds.length === 0) {
      // Filter topic's userPercentages if userId is provided
      const filteredTopicUserPercentages: Record<string, number> = {};
      if (userId) {
        const normalizedUserId = this.normalizeId(userId);
        if (normalizedUserId && topic.userPercentages) {
          // Handle Map case (Mongoose document)
          if (topic.userPercentages instanceof Map) {
            const userPercentage = topic.userPercentages.get(normalizedUserId);
            if (userPercentage !== undefined && userPercentage !== null) {
              filteredTopicUserPercentages[normalizedUserId] = userPercentage;
            }
          } else if (
            topic.userPercentages &&
            typeof topic.userPercentages === 'object' &&
            !Array.isArray(topic.userPercentages)
          ) {
            // Handle plain object case (when using .lean(), Maps become objects)
            const userPercentagesObj = topic.userPercentages;
            const userPercentage = userPercentagesObj[normalizedUserId];
            if (userPercentage !== undefined && userPercentage !== null) {
              filteredTopicUserPercentages[normalizedUserId] = userPercentage;
            }
          }
        }
      }

      return {
        ...topic,
        subTopics: [],
        userPercentages: userId
          ? filteredTopicUserPercentages
          : topic.userPercentages,
      };
    }

    // Get all subtopics
    const subtopics = await this.subTopicModel
      .find({ _id: { $in: subTopicIds } })
      .lean()
      .exec();

    // Filter userPercentages in each subtopic if userId is provided
    let filteredSubtopics = subtopics;
    if (userId) {
      const normalizedUserId = this.normalizeId(userId);
      filteredSubtopics = subtopics.map((subtopic) => {
        const filteredUserPercentages: Record<string, number> = {};

        if (normalizedUserId && subtopic.userPercentages) {
          // Handle Map case (Mongoose document)
          if (subtopic.userPercentages instanceof Map) {
            const userPercentage =
              subtopic.userPercentages.get(normalizedUserId);
            if (userPercentage !== undefined && userPercentage !== null) {
              filteredUserPercentages[normalizedUserId] = userPercentage;
            }
          } else if (
            subtopic.userPercentages &&
            typeof subtopic.userPercentages === 'object' &&
            !Array.isArray(subtopic.userPercentages)
          ) {
            // Handle plain object case (when using .lean(), Maps become objects)
            const userPercentagesObj = subtopic.userPercentages;
            const userPercentage = userPercentagesObj[normalizedUserId];
            if (userPercentage !== undefined && userPercentage !== null) {
              filteredUserPercentages[normalizedUserId] = userPercentage;
            }
          }
        }

        return {
          ...subtopic,
          userPercentages: filteredUserPercentages,
        };
      });
    }

    // Filter topic's userPercentages if userId is provided
    let filteredTopicUserPercentages: Record<string, number> | undefined =
      undefined;
    if (userId) {
      const normalizedUserId = this.normalizeId(userId);
      filteredTopicUserPercentages = {};
      if (normalizedUserId && topic.userPercentages) {
        // Handle Map case (Mongoose document)
        if (topic.userPercentages instanceof Map) {
          const userPercentage = topic.userPercentages.get(normalizedUserId);
          if (userPercentage !== undefined && userPercentage !== null) {
            filteredTopicUserPercentages[normalizedUserId] = userPercentage;
          }
        } else if (
          topic.userPercentages &&
          typeof topic.userPercentages === 'object' &&
          !Array.isArray(topic.userPercentages)
        ) {
          // Handle plain object case (when using .lean(), Maps become objects)
          const userPercentagesObj = topic.userPercentages;
          const userPercentage = userPercentagesObj[normalizedUserId];
          if (userPercentage !== undefined && userPercentage !== null) {
            filteredTopicUserPercentages[normalizedUserId] = userPercentage;
          }
        }
      }
    }

    return {
      ...topic,
      subTopics: filteredSubtopics,
      userPercentages: userId
        ? filteredTopicUserPercentages
        : topic.userPercentages,
    };
  }

  /**
   * Get subtopic by ID
   * Returns complete subtopic data filtered by userId if provided
   * Only shows userPercentages, questionsAsked, and moreDetailsRequests for the authenticated user
   */
  async getSubTopicById(subTopicId: string, userId?: string) {
    if (userId) {
      // await this.assertIndividualUser(userId);
    }

    if (!subTopicId) {
      throw new BadRequestException('subTopicId is required');
    }

    const normalizedSubTopicId = this.normalizeId(subTopicId);
    if (!normalizedSubTopicId) {
      throw new BadRequestException('Invalid subTopicId');
    }

    // Get subtopic
    const subtopic = await this.subTopicModel
      .findById(normalizedSubTopicId)
      .lean()
      .exec();

    if (!subtopic) {
      throw new NotFoundException('Subtopic not found');
    }

    // If userId is provided, filter the data to show only user-specific information
    if (userId) {
      const normalizedUserId = this.normalizeId(userId);

      // Filter userPercentages - only show current user's percentage
      const filteredUserPercentages: Record<string, number> = {};
      if (subtopic.userPercentages && normalizedUserId) {
        // Handle Map case (Mongoose document)
        if (subtopic.userPercentages instanceof Map) {
          const userPercentage = subtopic.userPercentages.get(normalizedUserId);
          if (userPercentage !== undefined && userPercentage !== null) {
            filteredUserPercentages[normalizedUserId] = userPercentage;
          }
        } else if (
          subtopic.userPercentages &&
          typeof subtopic.userPercentages === 'object' &&
          !Array.isArray(subtopic.userPercentages)
        ) {
          // Handle plain object case (when using .lean(), Maps become objects)
          const userPercentagesObj = subtopic.userPercentages;
          const userPercentage = userPercentagesObj[normalizedUserId];
          if (userPercentage !== undefined && userPercentage !== null) {
            filteredUserPercentages[normalizedUserId] = userPercentage;
          }
        }
      }

      // Filter questionsAsked - only show questions asked by current user
      const filteredQuestionsAsked = (subtopic.questionsAsked || []).filter(
        (qa) => {
          const qaUserId = qa.userId ? this.normalizeId(qa.userId) : null;
          return qaUserId === normalizedUserId;
        },
      );

      // Filter moreDetailsRequests - only show requests made by current user
      const filteredMoreDetailsRequests = (
        subtopic.moreDetailsRequests || []
      ).filter((mdr) => {
        const mdrUserId = mdr.userId ? this.normalizeId(mdr.userId) : null;
        return mdrUserId === normalizedUserId;
      });

      return {
        ...subtopic,
        userPercentages: filteredUserPercentages,
        questionsAsked: filteredQuestionsAsked,
        moreDetailsRequests: filteredMoreDetailsRequests,
      };
    }

    // If no userId provided, return all data (for backward compatibility)
    return subtopic;
  }

  /**
   * Get GameProgress for a user by userId
   */
  async getGameProgress(userId: string): Promise<LeanGameProgress | null> {
    const normalizedUserId = this.normalizeId(userId);
    if (!normalizedUserId) {
      return null;
    }
    const result = await this.gameProgressModel
      .findOne({ userId: normalizedUserId })
      .lean()
      .exec();
    return result as LeanGameProgress | null;
  }

  /**
   * Get level name from level number
   */
  getLevelNameForLevel(level: number): string {
    return this.getLevelName(level);
  }
}
