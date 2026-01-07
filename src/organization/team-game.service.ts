import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  Model,
  FilterQuery,
  isValidObjectId,
  Types,
  UpdateQuery,
  Document,
} from 'mongoose';
import { User, UserDocument } from '../users/entities/user.entity';
import { TeamMember, TeamMemberDocument } from './entities/team-member.entity';
import { Team, TeamDocument } from './entities/team.entity';
import {
  Organization,
  OrganizationDocument,
} from './entities/orgenaztion.entity';
import { Deck, DeckDocument } from '../content/schemas/deck.schema';
import { Game, GameDocument } from '../content/schemas/game.schema';
import { Topic, TopicDocument } from '../content/schemas/topic.schema';
import { SubTopic, SubTopicDocument } from '../content/schemas/subtopic.schema';
import { randomUUID } from 'crypto';
import { Question } from '../content/interfaces/question.interface';
import { DeviceAccessService } from '../content/device-access.service';
import {
  MemberProgress,
  MemberProgressDocument,
} from './entities/member-progress.schema';
import { DeckAIService } from '../content/deck-ai.service';
import { ContentService } from '../content/content.service';
import {
  TeamGameScore,
  TeamGameScoreDocument,
} from './entities/team-game.entity';
import {
  TeamGameChat,
  TeamGameChatDocument,
} from './entities/teamgame-chat.entity';
import { USER_TYPE } from 'src/common/enum';

// Helper types for lean document results
type LeanDeck = Omit<Deck, keyof Document> & {
  _id: Types.ObjectId;
  flashcardAccuracies?: Array<{
    userId: string;
    accuracy: number;
    gamesPlayed: number;
  }>;
  battleAccuracies?: Array<{
    userId: string;
    accuracy: number;
    gamesPlayed: number;
  }>;
};
type LeanSubTopic = Omit<SubTopic, keyof Document> & {
  _id: Types.ObjectId;
  flashcardAccuracies?: Array<{
    userId: string;
    accuracy: number;
    gamesPlayed: number;
  }>;
  battleAccuracies?: Array<{
    userId: string;
    accuracy: number;
    gamesPlayed: number;
  }>;
};
type LeanTopic = Omit<Topic, keyof Document> & {
  _id: Types.ObjectId;
  flashcardAccuracies?: Array<{
    userId: string;
    accuracy: number;
    gamesPlayed: number;
  }>;
  battleAccuracies?: Array<{
    userId: string;
    accuracy: number;
    gamesPlayed: number;
  }>;
};
type LeanGame = Pick<
  GameDocument,
  'accuracy' | 'playerAnswers' | 'type' | 'gameMode'
>;
type LeanTeam = Pick<TeamDocument, '_id' | 'teamName'>;
type LeanUser = Pick<
  UserDocument,
  | '_id'
  | 'name'
  | 'email'
  | 'profileImage'
  | 'isOnline'
  | 'lastSeen'
  | 'organization'
  | 'isActive'
>;
type AccuracyEntry = { userId: string; accuracy: number; gamesPlayed: number };
type TeamMemberWithUser = {
  _id: Types.ObjectId;
  name: string | null;
  email: string;
  profileImage?: string;
  isOnline: boolean;
  lastSeen?: Date;
  teamMemberId: Types.ObjectId | string;
  teamId: string;
  organizationId: string;
  isAdmin: boolean;
  status: string;
  joinedAt: Date;
};
type DeckSearchResult = {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  category?: string;
};

@Injectable()
export class TeamGameService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(TeamMember.name)
    private readonly teamMemberModel: Model<TeamMemberDocument>,
    @InjectModel(Team.name) private readonly teamModel: Model<TeamDocument>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationDocument>,
    @InjectModel(MemberProgress.name)
    private readonly memberProgressModel: Model<MemberProgressDocument>,
    @InjectModel(Deck.name) private readonly deckModel: Model<DeckDocument>,
    @InjectModel(Game.name) private readonly gameModel: Model<GameDocument>,
    @InjectModel(Topic.name) private readonly topicModel: Model<TopicDocument>,
    @InjectModel(SubTopic.name)
    private readonly subTopicModel: Model<SubTopicDocument>,
    @InjectModel(TeamGameScore.name)
    private readonly teamGameScoreModel: Model<TeamGameScoreDocument>,
    @InjectModel(TeamGameChat.name)
    private readonly teamGameChatModel: Model<TeamGameChatDocument>,
    private aiService: DeckAIService,
    private readonly deviceAccessService: DeviceAccessService,
    private readonly contentService: ContentService,
  ) {}

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
   * Find the deck that owns a given subTopic (contentId).
   * Returns the deckId or null if no deck contains the subTopic.
   */
  async findDeckIdBySubTopicId(subTopicId: string | undefined | null) {
    try {
      const normalizedSubTopicId = this.normalizeId(subTopicId);
      if (!normalizedSubTopicId) {
        return null;
      }

      const deck = await this.deckModel
        .findOne({ contentIds: normalizedSubTopicId })
        .select('_id')
        .lean()
        .exec();

      return this.normalizeId(deck?._id);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Find the deck that owns a given topicId.
   * Returns the deckId or null if no deck contains the topicId.
   * Decks store topicIds in their contentIds array.
   */
  async findDeckIdByTopicId(topicId: string | undefined | null) {
    try {
      const normalizedTopicId = this.normalizeId(topicId);
      if (!normalizedTopicId) {
        return null;
      }

      const deck = await this.deckModel
        .findOne({ contentIds: normalizedTopicId })
        .select('_id')
        .lean()
        .exec();

      return this.normalizeId(deck?._id);
    } catch (error) {
      throw error;
    }
  }

  private calculateAverage(values: number[]): number {
    if (!values || values.length === 0) {
      return 0;
    }
    const sum = values.reduce((acc, val) => acc + val, 0);
    return Math.round((sum / values.length) * 100) / 100;
  }

  /**
   * Upsert a user's accuracy entry onto a deck for either flashcard or battle mode.
   */
  private async upsertDeckAccuracy(
    deckId: string | undefined,
    userId: string | null,
    accuracy: number,
    type: 'flashcard' | 'battle',
  ): Promise<void> {
    try {
      const normalizedDeckId = this.normalizeId(deckId);
      const normalizedUserId = this.normalizeId(userId);

      if (!normalizedDeckId || !normalizedUserId || Number.isNaN(accuracy)) {
        return;
      }

      const arrayField =
        type === 'flashcard' ? 'flashcardAccuracies' : 'battleAccuracies';

      // Fetch current entry to compute rolling average
      const deckDoc = await this.deckModel
        .findById(normalizedDeckId)
        .select(arrayField)
        .lean();

      const deckDocTyped = deckDoc as LeanDeck;
      const accuracyArray =
        arrayField === 'flashcardAccuracies'
          ? deckDocTyped?.flashcardAccuracies
          : deckDocTyped?.battleAccuracies;
      const existingEntry = accuracyArray?.find(
        (entry: AccuracyEntry) =>
          this.normalizeId(entry.userId) === normalizedUserId,
      );

      const prevGames = existingEntry?.gamesPlayed ?? 0;
      const prevAccuracy = existingEntry?.accuracy ?? 0;
      const newGamesPlayed = prevGames + 1;
      const newAverage =
        Math.round(
          ((prevAccuracy * prevGames + accuracy) / newGamesPlayed) * 100,
        ) / 100;

      if (existingEntry) {
        await this.deckModel.updateOne(
          {
            _id: normalizedDeckId,
            [`${arrayField}.userId`]: normalizedUserId,
          },
          {
            $set: {
              [`${arrayField}.$.accuracy`]: newAverage,
              [`${arrayField}.$.gamesPlayed`]: newGamesPlayed,
            },
          },
        );
      } else {
        await this.deckModel.updateOne(
          { _id: normalizedDeckId },
          {
            $push: {
              [arrayField]: {
                userId: normalizedUserId,
                accuracy,
                gamesPlayed: 1,
              },
            },
          },
        );
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Public wrapper to persist per-user deck accuracy.
   */
  async recordDeckAccuracy(
    deckId: string | undefined,
    userId: string,
    accuracy: number,
    type: 'flashcard' | 'battle',
  ): Promise<void> {
    try {
      return await this.upsertDeckAccuracy(deckId, userId, accuracy, type);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update subtopic accuracy for a user after completing a flashcard or battle game.
   * Uses rolling average: (prevAccuracy * prevGames + newAccuracy) / (prevGames + 1)
   */
  async recordSubTopicAccuracy(
    subTopicId: string | undefined,
    userId: string,
    accuracy: number,
    type: 'flashcard' | 'battle',
  ): Promise<void> {
    try {
      const normalizedSubTopicId = this.normalizeId(subTopicId);
      const normalizedUserId = this.normalizeId(userId);

      if (
        !normalizedSubTopicId ||
        !normalizedUserId ||
        Number.isNaN(accuracy)
      ) {
        return;
      }

      const arrayField =
        type === 'flashcard' ? 'flashcardAccuracies' : 'battleAccuracies';

      // Fetch current entry to compute rolling average
      const subTopicDoc = await this.subTopicModel
        .findById(normalizedSubTopicId)
        .select(arrayField)
        .lean();

      const subTopicDocTyped = subTopicDoc as unknown as LeanSubTopic;
      const accuracyArray =
        arrayField === 'flashcardAccuracies'
          ? subTopicDocTyped?.flashcardAccuracies
          : subTopicDocTyped?.battleAccuracies;
      const existingEntry = accuracyArray?.find(
        (entry: AccuracyEntry) =>
          this.normalizeId(entry.userId) === normalizedUserId,
      );

      const prevGames = existingEntry?.gamesPlayed ?? 0;
      const prevAccuracy = existingEntry?.accuracy ?? 0;
      const newGamesPlayed = prevGames + 1;
      const newAverage =
        Math.round(
          ((prevAccuracy * prevGames + accuracy) / newGamesPlayed) * 100,
        ) / 100;

      if (existingEntry) {
        await this.subTopicModel.updateOne(
          {
            _id: normalizedSubTopicId,
            [`${arrayField}.userId`]: normalizedUserId,
          },
          {
            $set: {
              [`${arrayField}.$.accuracy`]: newAverage,
              [`${arrayField}.$.gamesPlayed`]: newGamesPlayed,
            },
          },
        );
      } else {
        await this.subTopicModel.updateOne(
          { _id: normalizedSubTopicId },
          {
            $push: {
              [arrayField]: {
                userId: normalizedUserId,
                accuracy,
                gamesPlayed: 1,
              },
            },
          },
        );
      }

      // After updating subtopic, store the subtopic accuracy entry in the parent topic
      await this.updateTopicAccuracyFromSubTopic(
        normalizedSubTopicId,
        normalizedUserId,
        newAverage,
        newGamesPlayed,
        type,
      );
    } catch (error) {
      throw error;
    }
  }

  /**
   * Store accuracy entry in the topic table.
   * For flashcard: aggregates all subtopic accuracies (acc1 + acc2 + ... + accN) / N
   * For battle: stores without subtopicId (rolling average per user)
   */

  private async updateTopicAccuracyFromSubTopic(
    subTopicId: string,
    userId: string,
    accuracy: number,
    gamesPlayed: number,
    type: 'flashcard' | 'battle',
  ): Promise<void> {
    try {
      const normalizedSubTopicId = this.normalizeId(subTopicId);
      const normalizedUserId = this.normalizeId(userId);

      if (!normalizedSubTopicId || !normalizedUserId) {
        return;
      }

      // Get the subtopic to find its topicId
      const subTopic = await this.subTopicModel
        .findById(normalizedSubTopicId)
        .select('topicId')
        .lean();

      if (!subTopic || !subTopic.topicId) {
        return;
      }

      const topicId = this.normalizeId(subTopic.topicId);
      if (!topicId) {
        return;
      }

      const arrayField =
        type === 'flashcard' ? 'flashcardAccuracies' : 'battleAccuracies';

      if (type === 'flashcard') {
        // Flashcard: Aggregate all subtopic accuracies (acc1 + acc2 + ... + accN) / N
        // OPTIMIZED: Fetch topic with both subTopics and accuracy array in single query
        const topic = await this.topicModel
          .findById(topicId)
          .select(`subTopics ${arrayField}`)
          .lean();

        if (!topic || !topic.subTopics || topic.subTopics.length === 0) {
          return;
        }

        // Get all subtopics for this topic
        const subTopicIds = topic.subTopics
          .map((id) => this.normalizeId(id))
          .filter((id): id is string => !!id);

        // Fetch all accuracies for this user from all subtopics using aggregation
        const validObjectIds = subTopicIds
          .filter((id) => isValidObjectId(id))
          .map((id) => new Types.ObjectId(id));

        const accuracyResults =
          validObjectIds.length > 0
            ? await this.subTopicModel.aggregate([
                {
                  $match: {
                    _id: { $in: validObjectIds },
                  },
                },
                {
                  $unwind: {
                    path: '$flashcardAccuracies',
                    preserveNullAndEmptyArrays: false,
                  },
                },
                {
                  $match: {
                    $expr: {
                      $eq: [
                        { $toString: '$flashcardAccuracies.userId' },
                        normalizedUserId,
                      ],
                    },
                  },
                },
                {
                  $project: {
                    accuracy: {
                      $cond: {
                        if: {
                          $eq: [
                            { $type: '$flashcardAccuracies.accuracy' },
                            'number',
                          ],
                        },
                        then: '$flashcardAccuracies.accuracy',
                        else: null,
                      },
                    },
                  },
                },
                {
                  $match: {
                    accuracy: { $ne: null },
                  },
                },
                {
                  $group: {
                    _id: null,
                    accuracies: { $push: '$accuracy' },
                  },
                },
              ])
            : [];

        // Extract accuracies array from aggregation result
        const accuracies: number[] =
          accuracyResults.length > 0 && accuracyResults[0].accuracies
            ? accuracyResults[0].accuracies
            : [];

        // Calculate average: (acc1 + acc2 + ... + accN) / N
        let topicAccuracy = 0;
        if (accuracies.length > 0) {
          const sum = accuracies.reduce((a, b) => a + b, 0);
          topicAccuracy = Math.round((sum / accuracies.length) * 100) / 100;
        }

        // OPTIMIZED: Use topic fetched above to check existing entry (no additional query needed)
        const topicDocTyped = topic as unknown as LeanTopic;
        const accuracyArray = topicDocTyped?.flashcardAccuracies;
        const existingEntry = accuracyArray?.find(
          (entry: AccuracyEntry) =>
            this.normalizeId(entry.userId) === normalizedUserId,
        );

        if (existingEntry) {
          // Update existing entry with aggregated average
          await this.topicModel.updateOne(
            {
              _id: topicId,
              [`${arrayField}.userId`]: normalizedUserId,
            },
            {
              $set: {
                [`${arrayField}.$.accuracy`]: topicAccuracy,
                [`${arrayField}.$.gamesPlayed`]: accuracies.length,
              },
            },
          );
        } else {
          // Create new entry with aggregated average
          await this.topicModel.updateOne(
            { _id: topicId },
            {
              $push: {
                [arrayField]: {
                  userId: normalizedUserId,
                  accuracy: topicAccuracy,
                  gamesPlayed: accuracies.length,
                },
              },
            },
          );
        }
      } else {
        // Battle: Store without subtopicId (rolling average per user)
        const topicDoc = await this.topicModel
          .findById(topicId)
          .select(arrayField)
          .lean();

        const topicDocTyped = topicDoc as unknown as LeanTopic;
        const accuracyArray =
          arrayField === 'flashcardAccuracies'
            ? topicDocTyped?.flashcardAccuracies
            : topicDocTyped?.battleAccuracies;
        const existingEntry = accuracyArray?.find(
          (entry: AccuracyEntry) =>
            this.normalizeId(entry.userId) === normalizedUserId,
        );

        if (existingEntry) {
          // Update existing entry (rolling average)
          await this.topicModel.updateOne(
            {
              _id: topicId,
              [`${arrayField}.userId`]: normalizedUserId,
            },
            {
              $set: {
                [`${arrayField}.$.accuracy`]: accuracy,
                [`${arrayField}.$.gamesPlayed`]: gamesPlayed,
              },
            },
          );
        } else {
          // Create new entry without subtopicId
          await this.topicModel.updateOne(
            { _id: topicId },
            {
              $push: {
                [arrayField]: {
                  userId: normalizedUserId,
                  accuracy,
                  gamesPlayed,
                },
              },
            },
          );
        }
      }
    } catch (error) {
      // Non-blocking: don't interrupt game completion
    }
  }

  private getUserAccuracyFromGame(
    game: LeanGame | null | undefined,
    userId: string,
  ): number | null {
    if (!game) {
      return null;
    }

    const accuracyMap = game.accuracy as Record<string, number> | undefined;
    if (accuracyMap && typeof accuracyMap[userId] === 'number') {
      return accuracyMap[userId];
    }

    const playerAnswers = game.playerAnswers as
      | Array<{ userId: string; isCorrect: boolean }>
      | undefined;
    if (!playerAnswers) {
      return null;
    }

    const answersForUser = playerAnswers.filter(
      (a) => this.normalizeId(a.userId) === userId,
    );
    if (answersForUser.length === 0) {
      return null;
    }

    const correctCount = answersForUser.filter((a) => a.isCorrect).length;
    const accuracy =
      answersForUser.length > 0
        ? (correctCount / answersForUser.length) * 100
        : 0;

    return Math.round(accuracy * 100) / 100;
  }

  async updateTeamMemberOnlineStatus(
    userId: string,
    isOnline: boolean,
  ): Promise<LeanUser | null> {
    try {
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

      return updated as LeanUser | null;
    } catch (error) {
      throw error;
    }
  }

  async getTeamMembers(
    teamId?: string,
    organizationId?: string,
  ): Promise<TeamMemberWithUser[]> {
    try {
      const query: FilterQuery<TeamMemberDocument> = {
        status: 'approved', // Only approved team members
      };

      if (teamId) {
        const normalizedTeamId = this.normalizeId(teamId);
        if (!normalizedTeamId) {
          throw new BadRequestException('Invalid team ID');
        }
        query.team = normalizedTeamId;
      }

      if (organizationId) {
        const normalizedOrgId = this.normalizeId(organizationId);
        if (!normalizedOrgId) {
          throw new BadRequestException('Invalid organization ID');
        }
        query.organization = normalizedOrgId;
      }

      // Get team members
      const teamMembers = await this.teamMemberModel
        .find(query)
        .populate('user', '_id name email profileImage isOnline lastSeen')
        .lean()
        .exec();

      // Include all members with users (both online and offline)
      type PopulatedTeamMember = TeamMemberDocument & { user: LeanUser };
      const allTeamMembers = (teamMembers as unknown as PopulatedTeamMember[])
        .filter((member) => {
          // Check if member has a user and user is active
          return (
            member.user &&
            typeof member.user === 'object' &&
            member.user.isActive !== false
          );
        })
        .map((member): TeamMemberWithUser => {
          const user = member.user;
          return {
            _id: user._id,
            name: user.name || null,
            email: user.email,
            profileImage: user.profileImage,
            isOnline: user.isOnline || false,
            lastSeen: user.lastSeen,
            teamMemberId: member._id,
            teamId: this.normalizeId(member.team) || '',
            organizationId: this.normalizeId(member.organization) || '',
            isAdmin: member.isAdmin,
            status: member.status,
            joinedAt: member.joinedAt,
          };
        });

      // Sort by isOnline first (online users first), then by lastSeen descending
      return allTeamMembers.sort((a, b) => {
        // Online users first
        if (a.isOnline !== b.isOnline) {
          return a.isOnline ? -1 : 1;
        }
        // Then sort by lastSeen descending
        const aTime = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
        const bTime = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
        return bTime - aTime;
      });
    } catch (error) {
      throw error;
    }
  }

  async searchTeamMembersName(
    name: string,
    userId?: string,
    teamId?: string,
    organizationId?: string,
  ): Promise<TeamMemberWithUser[]> {
    try {
      const trimmedName = name?.trim();
      if (!trimmedName) {
        return [];
      }

      const query: FilterQuery<TeamMemberDocument> = {
        status: 'approved', // Only approved team members
      };

      if (teamId) {
        const normalizedTeamId = this.normalizeId(teamId);
        if (normalizedTeamId) {
          query.team = normalizedTeamId;
        }
      }

      if (organizationId) {
        const normalizedOrgId = this.normalizeId(organizationId);
        if (normalizedOrgId) {
          query.organization = normalizedOrgId;
        }
      }

      // Get team members
      const teamMembers = await this.teamMemberModel
        .find(query)
        .populate('user', '_id name email profileImage isOnline lastSeen')
        .lean()
        .exec();

      // Filter to include members with users (both online and offline) that match the name
      type PopulatedTeamMember = TeamMemberDocument & { user: LeanUser };
      const matchingTeamMembers = (
        teamMembers as unknown as PopulatedTeamMember[]
      )
        .filter((member) => {
          // Check if member has a user and user is active
          if (
            !member.user ||
            typeof member.user !== 'object' ||
            member.user.isActive === false
          ) {
            return false;
          }

          // Exclude current user if provided
          if (userId) {
            const normalizedUserId = this.normalizeId(userId);
            const memberUserId = this.normalizeId(member.user._id);
            if (normalizedUserId && memberUserId === normalizedUserId) {
              return false;
            }
          }

          // Check if name matches (case-insensitive)
          const userName = member.user.name || '';
          return userName.toLowerCase().includes(trimmedName.toLowerCase());
        })
        .map((member): TeamMemberWithUser => {
          const user = member.user;
          return {
            _id: user._id,
            name: user.name || null,
            email: user.email,
            profileImage: user.profileImage,
            isOnline: user.isOnline || false,
            lastSeen: user.lastSeen,
            teamMemberId: member._id,
            teamId: this.normalizeId(member.team) || '',
            organizationId: this.normalizeId(member.organization) || '',
            isAdmin: member.isAdmin,
            status: member.status,
            joinedAt: member.joinedAt,
          };
        });

      // Sort by isOnline first (online users first), then by name
      return matchingTeamMembers.sort((a, b) => {
        if (a.isOnline !== b.isOnline) {
          return a.isOnline ? -1 : 1;
        }
        return (a.name || '').localeCompare(b.name || '');
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Search decks by partial name match (case-insensitive).
   * Returns a lean list of decks with basic fields.
   */
  async searchDeckName(
    searchTerm: string,
    limit: number = 10,
  ): Promise<DeckSearchResult[]> {
    try {
      const term = searchTerm?.trim();
      if (!term) {
        return [];
      }

      // Escape regex special chars to avoid unintended patterns
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');

      const parsedLimit = Number(limit);
      const safeLimit =
        Number.isFinite(parsedLimit) && parsedLimit > 0
          ? Math.min(parsedLimit, 50)
          : 10;

      return await this.deckModel
        .find({ name: regex })
        .select('_id name description category')
        .limit(safeLimit)
        .sort({ createdAt: -1 })
        .lean()
        .exec();
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get random deck filtered by organization's admin/superadmin
   * @param organizationId Organization ID to filter decks
   * @returns Random deck created by organization's admin/superadmin
   */
  async getRandomDeck(organizationId?: string): Promise<LeanDeck> {
    try {
      const query: FilterQuery<DeckDocument> = {};

      // If organizationId is provided, filter decks by organization's admin/superadmin
      if (organizationId) {
        const normalizedOrgId = this.normalizeId(organizationId);
        if (normalizedOrgId) {
          // Find all users in this organization with userType 'admin' or 'superAdmin'
          const orgAdmins = await this.userModel
            .find({
              organization: normalizedOrgId,
              userType: { $in: [USER_TYPE[2], USER_TYPE[1]] },
            })
            .select('_id')
            .lean()
            .exec();

          const adminUserIds = orgAdmins
            .map((admin) => this.normalizeId(admin._id))
            .filter((id): id is string => id !== null);

          if (adminUserIds.length > 0) {
            // Filter decks created by organization's admin/superadmin
            // No need to check isPublic or status - any deck created by admin/superAdmin is allowed
            query.userId = { $in: adminUserIds };
          } else {
            // No admins found in organization, return empty result
            throw new NotFoundException(
              'No admin or superAdmin found in your organization. Please contact your organization administrator.',
            );
          }
        }
      } else {
        // If no organizationId, we can't filter by admin - this shouldn't happen for team games
        throw new BadRequestException(
          'Organization ID is required to get random deck for team games.',
        );
      }

      // Get count of matching decks
      const count = await this.deckModel.countDocuments(query).exec();

      if (count === 0) {
        throw new NotFoundException(
          "No decks available from your organization's admin or superAdmin. Please ask an admin to create a deck.",
        );
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
    } catch (error) {
      throw error;
    }
  }

  /**
   * Validates that all teams have equal number of accepted players
   * Supports 2 teams or 3 teams
   * @param participants Array of participant user IDs
   * @param inviterId Optional inviter/admin ID to exclude from team validation
   * @returns Object with validation result and team grouping info
   */

  async validateTeamBasedAcceptance(
    participants: string[],
    inviterId?: string,
  ): Promise<{
    isValid: boolean;
    errorMessage?: string;
    teams: Map<string, string[]>; // teamId -> participantIds
    teamAcceptanceCounts: Map<string, number>; // teamId -> accepted count
  }> {
    try {
      const teams = new Map<string, string[]>();
      const teamAcceptanceCounts = new Map<string, number>();

      // Get team memberships for all participants
      // Exclude inviter (admin) from validation - they can only view, not play
      const normalizedInviterId = inviterId
        ? this.normalizeId(inviterId)
        : null;
      const normalizedParticipants = participants
        .map((p) => this.normalizeId(p))
        .filter(
          (id): id is string => id !== null && id !== normalizedInviterId,
        );

      // OPTIMIZED: Use Mongoose aggregation to group participants by team directly in database
      const validObjectIds = normalizedParticipants
        .filter((id) => isValidObjectId(id))
        .map((id) => new Types.ObjectId(id));

      // Aggregate to group participants by team
      const groupedByTeam =
        validObjectIds.length > 0
          ? await this.teamMemberModel.aggregate([
              {
                $match: {
                  user: { $in: validObjectIds },
                  status: 'approved',
                },
              },
              {
                $group: {
                  _id: '$team',
                  participants: { $push: { $toString: '$user' } },
                },
              },
              {
                $project: {
                  teamId: { $toString: '$_id' },
                  participants: 1,
                  _id: 0,
                },
              },
            ])
          : [];

      // Build teams Map from aggregation results
      groupedByTeam.forEach((group) => {
        const teamId = group.teamId;
        if (teamId) {
          teams.set(teamId, group.participants);
        }
      });

      // Find participants who are not in any team (missing from aggregation results)
      const participantsInTeams = new Set<string>();
      groupedByTeam.forEach((group) => {
        group.participants.forEach((pid: string) => {
          participantsInTeams.add(pid);
        });
      });

      // Add participants without teams to "no-team" group
      normalizedParticipants.forEach((participantId) => {
        if (!participantsInTeams.has(participantId)) {
          const noTeamId = 'no-team';
          if (!teams.has(noTeamId)) {
            teams.set(noTeamId, []);
          }
          teams.get(noTeamId)!.push(participantId);
        }
      });

      // Get team details separately for error messages
      const teamIds = Array.from(teams.keys()).filter((id) => id !== 'no-team');
      const teamDetailsMap = new Map<string, LeanTeam>();
      if (teamIds.length > 0) {
        const validTeamObjectIds = teamIds
          .filter((id) => isValidObjectId(id))
          .map((id) => new Types.ObjectId(id));

        if (validTeamObjectIds.length > 0) {
          const teamsData = await this.teamModel
            .find({ _id: { $in: validTeamObjectIds } })
            .select('_id teamName')
            .lean()
            .exec();
          teamsData.forEach((team) => {
            const teamId = this.normalizeId(team._id);
            if (teamId) {
              teamDetailsMap.set(teamId, team as unknown as LeanTeam);
            }
          });
        }
      }

      // Count accepted players per team (all participants are considered accepted since they're in the room)
      // OPTIMIZED: Use Map.forEach() instead of for-of loop
      teams.forEach((teamParticipants, teamId) => {
        teamAcceptanceCounts.set(teamId, teamParticipants.length);
      });

      // Validate number of teams (must be 2 or 3)
      const teamCount = teams.size;
      if (teamCount !== 2 && teamCount !== 3) {
        return {
          isValid: false,
          errorMessage: `Game requires exactly 2 or 3 teams. Found ${teamCount} teams.`,
          teams,
          teamAcceptanceCounts,
        };
      }

      // Validate all teams have equal accepted players
      const acceptanceCounts = Array.from(teamAcceptanceCounts.values());
      const firstCount = acceptanceCounts[0];
      const allEqual = acceptanceCounts.every((count) => count === firstCount);

      if (!allEqual) {
        const teamCountsStr = Array.from(teamAcceptanceCounts.entries())
          .map(([teamId, count]) => {
            const teamDetails = teamDetailsMap.get(teamId);
            const teamName = teamDetails?.teamName || teamId;
            return `${teamName}: ${count}`;
          })
          .join(', ');
        return {
          isValid: false,
          errorMessage: `All teams must have equal number of accepted players. Current counts: ${teamCountsStr}`,
          teams,
          teamAcceptanceCounts,
        };
      }

      return {
        isValid: true,
        teams,
        teamAcceptanceCounts,
      };
    } catch (error) {
      throw error;
    }
  }

  async createTeamGame(
    userId: string,
    topicType?: 'random' | 'selected',
    deckId?: string,
    roomId?: string,
    participants?: string[],
    gameMode?: 'Regular' | 'Knockout',
    member?: number,
  ): Promise<{
    gameId: string;
    deckId: string;
    topicId: string;
    subTopicId: string;
  }> {
    try {
      if (!userId) {
        throw new BadRequestException('userId is required');
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

        deck = await this.deckModel.findById(normalizedDeckId).lean().exec();
        if (!deck) {
          throw new NotFoundException('Deck not found');
        }

        // Get user's organization to verify deck creator is admin/superAdmin
        // No need to check isPublic or status - any deck created by admin/superAdmin is allowed
        let organizationId: string | undefined = undefined;
        try {
          const user = await this.userModel
            .findById(userId)
            .select('organization')
            .lean()
            .exec();
          if (user?.organization) {
            organizationId = this.normalizeId(user.organization) || undefined;
          }
        } catch (error) {
          // Failed to get user organization for deck validation
        }

        // Verify deck is created by organization's admin/superAdmin
        if (organizationId) {
          const normalizedOrgId = this.normalizeId(organizationId);
          const normalizedDeckUserId = this.normalizeId(deck.userId);

          if (normalizedOrgId && normalizedDeckUserId) {
            // Allow if the deck creator is a superAdmin (global) regardless of org match
            const deckCreator = await this.userModel
              .findById(normalizedDeckUserId)
              .select('userType organization')
              .lean()
              .exec();

            if (deckCreator?.userType !== USER_TYPE[1]) {
              // Deck must belong to an admin/superAdmin of the same organization
              const orgAdmins = await this.userModel
                .find({
                  organization: normalizedOrgId,
                  userType: { $in: [USER_TYPE[2], USER_TYPE[1]] },
                })
                .select('_id')
                .lean()
                .exec();

              const adminUserIds = orgAdmins
                .map((admin) => this.normalizeId(admin._id))
                .filter((id): id is string => id !== null);
              // Check if deck creator is one of the organization's admins/superAdmins
              if (!adminUserIds.includes(normalizedDeckUserId)) {
                throw new BadRequestException(
                  'Only decks created by organization admin or superAdmin can be used.',
                );
              }
            }
          } else {
            throw new BadRequestException(
              'Unable to validate deck ownership. Please ensure you are part of an organization.',
            );
          }
        } else {
          // If user has no organization, only allow if deck belongs to user
          const normalizedUserId = this.normalizeId(userId);
          const normalizedDeckUserId = this.normalizeId(deck.userId);

          if (normalizedUserId !== normalizedDeckUserId) {
            throw new BadRequestException(
              'Only decks created by organization admin or superAdmin can be used.',
            );
          }
        }
      } else {
        // Get random deck - filter by organization's admin/superadmin
        let organizationId: string | undefined = undefined;

        // Get user's organization - required for team games
        try {
          const user = await this.userModel
            .findById(userId)
            .select('organization')
            .lean()
            .exec();
          if (user?.organization) {
            organizationId = this.normalizeId(user.organization) || undefined;
          } else {
            throw new BadRequestException(
              'You must be part of an organization to create team games. Please join an organization first.',
            );
          }
        } catch (error) {
          // If it's already a BadRequestException, rethrow it
          if (error instanceof BadRequestException) {
            throw error;
          }
          // If user lookup fails, throw error
          throw new BadRequestException(
            'Unable to verify organization membership. Please ensure you are part of an organization.',
          );
        }

        deck = await this.getRandomDeck(organizationId);
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
        gameMode: 'team',
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
        topicId: selectedTopicId || '',
        subTopicId: selectedSubTopicId,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Create a single player game for team member (same as singlePlayCreateGame from content.service.ts)
   */
  async teamMemberCreateGame(
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
    try {
      if (!userId) {
        throw new BadRequestException('userId is required');
      }

      // Use contentService's singlePlayCreateGame method directly for same logic
      return await this.contentService.singlePlayCreateGame(
        userId,
        subTopicId,
        difficulty,
      );
    } catch (error) {
      throw error;
    }
  }

  /**
   * Remove a player from an active team game in persistence
   */
  async removePlayerFromGame(gameId: string, userId: string) {
    try {
      const normalizedGameId = this.normalizeId(gameId);
      const normalizedUserId = this.normalizeId(userId);

      if (!normalizedGameId) {
        throw new BadRequestException('gameId is required');
      }

      if (!normalizedUserId) {
        throw new BadRequestException('userId is required');
      }

      const game = await this.gameModel
        .findOne({ gameId: normalizedGameId })
        .lean()
        .exec();
      if (!game) {
        throw new NotFoundException('Game not found');
      }

      await this.gameModel
        .updateOne(
          { gameId: normalizedGameId },
          {
            $pull: {
              players: normalizedUserId,
              acceptedPlayers: normalizedUserId,
            },
            $unset: {
              [`scores.${normalizedUserId}`]: '',
            },
          },
        )
        .exec();

      return {
        success: true,
        gameId: normalizedGameId,
        removedUserId: normalizedUserId,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Persist a chat message for a team game.
   * Stores organizationId for the sender and mirrors the message onto the game document.
   */
  async addTeamGameChatMessage(params: {
    userId: string;
    teamId: string;
    gameId: string;
    message: string;
  }): Promise<{
    _id: Types.ObjectId;
    gameId: string;
    teamId: string;
    userId: string;
    organizationId: string | null;
    message: string;
    createdAt: Date;
  }> {
    try {
      const trimmedMessage = params?.message?.trim();
      const normalizedUserId = this.normalizeId(params?.userId);
      const normalizedTeamId = this.normalizeId(params?.teamId);
      const normalizedGameId = this.normalizeId(params?.gameId);

      if (!normalizedUserId || !normalizedTeamId || !normalizedGameId) {
        throw new BadRequestException('gameId, teamId and userId are required');
      }

      if (!trimmedMessage) {
        throw new BadRequestException('Message is required');
      }

      // Fetch organizationId for the sender
      const user = await this.userModel
        .findById(normalizedUserId)
        .select('organization')
        .lean()
        .exec();

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const normalizedOrgId = this.normalizeId(user.organization);

      const created = await this.teamGameChatModel.create({
        gameId: normalizedGameId,
        teamId: normalizedTeamId,
        userId: normalizedUserId,
        organizationId: normalizedOrgId,
        message: trimmedMessage,
      });

      // Best-effort: also append to the game document's chatMessages array
      try {
        await this.gameModel.updateOne(
          { gameId: normalizedGameId },
          {
            $push: {
              chatMessages: {
                participantId: normalizedUserId,
                teamId: normalizedTeamId,
                message: trimmedMessage,
                timestamp: new Date(),
              },
            },
          },
        );
      } catch (error) {
        // Non-blocking: failed to append chat message to game
      }

      const createdObj = created.toObject() as TeamGameChatDocument & {
        createdAt?: Date;
      };
      const createdAt =
        createdObj.createdAt instanceof Date
          ? createdObj.createdAt
          : new Date();

      return {
        _id: createdObj._id,
        gameId: normalizedGameId,
        teamId: normalizedTeamId,
        userId: normalizedUserId,
        organizationId: normalizedOrgId,
        message: trimmedMessage,
        createdAt,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Increment cumulative points for a team (e.g., awarding win bonuses).
   */
  async incrementTeamPoints(teamId: string, pointsToAdd: number) {
    try {
      const normalizedTeamId = this.normalizeId(teamId);

      if (!normalizedTeamId) {
        throw new BadRequestException('teamId is required');
      }

      if (!isValidObjectId(normalizedTeamId)) {
        throw new BadRequestException('Invalid teamId');
      }

      const updatedTeam = await this.teamModel
        .findByIdAndUpdate(
          normalizedTeamId,
          { $inc: { points: pointsToAdd } },
          { new: true, lean: true },
        )
        .exec();

      if (!updatedTeam) {
        throw new NotFoundException('Team not found');
      }

      return updatedTeam;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Persist flashcard/battle/game accuracy averages on all TeamMember records
   * for the given user. Flashcard accuracy is averaged across completed single
   * games; battle accuracy across completed team games. gameAccuracy is the
   * average of the available category averages.
   */
  async refreshMemberAccuracies(userId: string): Promise<void> {
    try {
      const normalizedUserId = this.normalizeId(userId);
      if (!normalizedUserId) {
        return;
      }

      const completedGames = await this.gameModel
        .find({
          isCompleted: true,
          $or: [
            { players: normalizedUserId },
            { playerAnswers: { $elemMatch: { userId: normalizedUserId } } },
          ],
        })
        .select({
          type: 1,
          gameMode: 1,
          accuracy: 1,
          playerAnswers: 1,
        })
        .lean()
        .exec();

      const flashcardAccuracies: number[] = [];
      const battleAccuracies: number[] = [];

      completedGames.forEach((game) => {
        const accuracy = this.getUserAccuracyFromGame(
          game as unknown as LeanGame,
          normalizedUserId,
        );
        if (accuracy === null) {
          return;
        }

        if (game.type === 'single') {
          flashcardAccuracies.push(accuracy);
        } else if (game.gameMode === 'team') {
          battleAccuracies.push(accuracy);
        }
      });

      const flashcardAccuracy = this.calculateAverage(flashcardAccuracies);
      const battleAccuracy = this.calculateAverage(battleAccuracies);

      const categoryAccuracies = [
        flashcardAccuracies.length > 0 ? flashcardAccuracy : null,
        battleAccuracies.length > 0 ? battleAccuracy : null,
      ].filter((v): v is number => v !== null);

      const gameAccuracy = this.calculateAverage(categoryAccuracies);

      await this.teamMemberModel.updateMany(
        { user: normalizedUserId },
        {
          $set: {
            flashcardAccuracy,
            battleAccuracy,
            gameAccuracy,
          },
        },
        { upsert: false },
      );
    } catch (error) {
      throw error;
    }
  }

  /**
   * Record or update a user's battle accuracy and award points for the team.
   * Awards +10 points when accuracy is >= 80%.
   * Calculates and stores running average of response time.
   */
  async recordBattleAccuracyAndPoints(
    teamId: string,
    userId: string,
    accuracy: number,
    responseTime?: number, // total response time in seconds for this game
  ): Promise<void> {
    try {
      const normalizedTeamId = this.normalizeId(teamId);
      const normalizedUserId = this.normalizeId(userId);

      if (!normalizedTeamId || !normalizedUserId) {
        return;
      }

      const pointsToAdd = accuracy >= 80 ? 10 : 0;

      // Calculate running average response time if responseTime is provided
      const updateData: UpdateQuery<TeamGameScoreDocument> = {
        $inc: { points: pointsToAdd },
        $set: {
          accuracy,
        },
      };

      if (responseTime !== undefined && responseTime !== null) {
        // Fetch existing record to get current average and gamesPlayed
        const existingRecord = await this.teamGameScoreModel
          .findOne({ teamId: normalizedTeamId, userId: normalizedUserId })
          .select('averageResponseTime gamesPlayed')
          .lean()
          .exec();

        const oldGamesPlayed = existingRecord?.gamesPlayed || 0;
        const oldAverage = existingRecord?.averageResponseTime || 0;
        const newGamesPlayed = oldGamesPlayed + 1;

        // Calculate new running average: (oldAverage * oldGamesPlayed + newResponseTime) / newGamesPlayed
        const newAverage =
          oldGamesPlayed === 0
            ? responseTime
            : Math.round(
                ((oldAverage * oldGamesPlayed + responseTime) /
                  newGamesPlayed) *
                  100,
              ) / 100;

        updateData.$set.averageResponseTime = newAverage;
        updateData.$inc.gamesPlayed = 1;
      }

      await this.teamGameScoreModel.updateOne(
        { teamId: normalizedTeamId, userId: normalizedUserId },
        updateData,
        { upsert: true },
      );
    } catch (error) {
      throw error;
    }
  }
}
