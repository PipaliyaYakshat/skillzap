import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { TeamGameService } from './team-game.service';
import { UsersService } from '../users/users.service';
import { ContentService } from '../content/content.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UseFilters, Logger } from '@nestjs/common';
import { CustomWsExceptionFilter } from 'src/common/CustomWsExceptionFilter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/entities/user.entity';
import { Team, TeamDocument } from './entities/team.entity';
import { TeamMember, TeamMemberDocument } from './entities/team-member.entity';
import { Deck, DeckDocument } from '../content/schemas/deck.schema';
import { Topic, TopicDocument } from '../content/schemas/topic.schema';
import { SubTopic, SubTopicDocument } from '../content/schemas/subtopic.schema';
import { TeamGameScore, TeamGameScoreDocument } from './entities/team-game.entity';

type Question = {
  question: string;
  options?: string[];
  correctAnswer: string;
  id?: string;
  hint?: string;
};

type AnswerRecord = {
  question: string;
  userAnswer: string | null;
  correctAnswer: string;
  isCorrect: boolean;
  index: number;
  timestamp: Date;
  responstime?: number; // Optional: Response time from client
};

const QUESTION_TIME_SECONDS = 10;
const QUESTION_TIMEOUT_MS = QUESTION_TIME_SECONDS * 1000;

type Difficulty = 'easy' | 'medium' | 'hard';

type GameState = {
  gameId: string;
  userId: string;
  subTopicId: string;
  deckId?: string;
  socket: Socket;
  questions: Question[];
  currentIndex: number;
  lives: number;
  score: number;
  answers: AnswerRecord[];
  startedAt: Date;
  questionStartAt?: Date;
  isCorrect: boolean;
};

type TeamGameState = {
  gameId: string;
  roomId: string;
  deckId?: string;
  players: string[];
  teams: Map<string, string[]>; // teamId -> playerIds[]
  subTopicId: string;
  questions: Question[];
  currentIndex: number;
  playerAnswers: Map<string, AnswerRecord[]>;
  teamScores: Map<string, number>; // teamId -> score
  playerWrongAnswers: Map<string, number>; // Track wrong answers count per player
  eliminatedPlayers: Set<string>; // Track eliminated players
  gameMode?: 'Regular' | 'Knockout'; // Track game mode
  inviterId: string; // Admin/inviter who created the game (can view but cannot answer)
  startedAt: Date;
  questionStartAt?: Date;
  questionStartTimes: Map<number, Date>; // Track when each question started (index -> start time)
  isCompleted: boolean;
};

@UseFilters(new CustomWsExceptionFilter())
@WebSocketGateway({ cors: { origin: '*' } })
export class TeamGameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  private readonly logger = new Logger(TeamGameGateway.name);

  private userSockets: Map<string, Socket> = new Map();

  private teamGames: Map<string, TeamGameState> = new Map();

  private activeGames: Map<string, GameState> = new Map();

  constructor(
    private readonly teamGameService: TeamGameService,
    private readonly usersService: UsersService,
    private readonly contentService: ContentService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Team.name) private readonly teamModel: Model<TeamDocument>,
    @InjectModel(TeamMember.name) private readonly teamMemberModel: Model<TeamMemberDocument>,
    @InjectModel(Deck.name) private readonly deckModel: Model<DeckDocument>,
    @InjectModel(Topic.name) private readonly topicModel: Model<TopicDocument>,
    @InjectModel(SubTopic.name) private readonly subTopicModel: Model<SubTopicDocument>,
    @InjectModel(TeamGameScore.name) private readonly teamGameScoreModel: Model<TeamGameScoreDocument>,
  ) {}

  private normalizeId<T = any>(value: T): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    return value && typeof value === 'object' && 'toString' in value
      ? (value as any).toString()
      : String(value);
  }

  // Helper method to check if user is online
  private async checkUserIsOnline(userId: string): Promise<boolean> {
    try {
      const user = await this.usersService.findById(userId);
      return user?.isOnline === true;
    } catch (error) {
      return false;
    }
  }

  // Helper method to check if user is blocked
  private async checkUserIsBlocked(userId: string): Promise<{ isBlocked: boolean; user?: any }> {
    try {
      const user = await this.userModel.findById(userId).exec();
      if (!user) {
        return { isBlocked: false, user: null };
      }
      return { isBlocked: user.isBlocked === true, user };
    } catch (error) {
      return { isBlocked: false, user: null };
    }
  }

  // -------------------------------------------------------------
  // CONNECTION / DISCONNECT
  // -------------------------------------------------------------

  async handleConnection(@ConnectedSocket() client: Socket) {
      console.log('[handleConnection] Client connecting:', {
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });
    try {
      // Extract token from Authorization header
      const authHeader = client.handshake.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log('[handleConnection] Error: Authorization token required:', {
          socketId: client.id,
        });
        client.emit('error_response', { message: 'Authorization token required' });
        client.disconnect();
        return;
      }

      const token = authHeader.split(' ')[1];

      // Verify and decode token
      let decoded: any;
      try {
        decoded = this.jwtService.verify(token);
        console.log('[handleConnection] Token verified:', {
          socketId: client.id,
          hasDecoded: !!decoded,
        });
      } catch (error) {
        console.log('[handleConnection] Error: Invalid or expired token:', {
          socketId: client.id,
          error: error.message,
        });
        client.emit('error_response', { message: 'Invalid or expired token' });
        client.disconnect();
        return;
      }

      // Extract userId from token (token contains { id, role })
      const userId = decoded.id || decoded.userId;
      if (!userId) {
        console.log('[handleConnection] Error: userId not found in token:', {
          socketId: client.id,
          decoded,
        });
        client.emit('error_response', { message: 'Invalid token: userId not found' });
        client.disconnect();
        return;
      }

      // Check if user is blocked
      const user = await this.userModel.findById(userId).exec();
      if (!user) {
        console.log('[handleConnection] Error: User not found:', {
          socketId: client.id,
          userId,
        });
        client.emit('error_response', { message: 'User not found' });
        client.disconnect();
        return;
      }
      if (user.isBlocked === true) {
        console.log('[handleConnection] Error: User account is blocked:', {
          socketId: client.id,
          userId,
        });
        client.emit('error_response', { message: 'Your account is blocked' });
        client.disconnect();
        return;
      }

      client.data.userId = userId;

      // store socket
      this.userSockets.set(userId, client);
      // keep contentService aware of sockets map (your existing design)
      if (typeof this.contentService.setUserSockets === 'function') {
        this.contentService.setUserSockets(this.userSockets);
      }

      // DO NOT clear rooms on reconnect - allow users to rejoin their room
      // Only clear pending invites (these should be cleared on disconnect)
      this.contentService.clearPendingInvites(userId);

      // Check if user was in a room before disconnect and allow them to rejoin
      const existingRoom = this.contentService.getRoomByUserId(userId);
      if (existingRoom) {
        console.log('[handleConnection] User was in a room before reconnect:', {
          userId,
          roomId: existingRoom.roomId,
          participants: existingRoom.participants,
        });
        // User can manually rejoin via joinRoom event if needed
        // Don't auto-join here to avoid race conditions
      }

      const now = new Date();
      // update DB user status
      if (typeof this.usersService.updateUserSocketInfo === 'function') {
        await this.usersService.updateUserSocketInfo(userId, {
          socketId: client.id,
          isOnline: true,
          socketConnected: true,
          lastSeen: now,
          $set: {
            'socketInfo.connectedAt': now,
            'socketInfo.lastActivity': now,
          },
          $inc: { 'socketInfo.connectionCount': 1 },
        });
      }

      console.log('[handleConnection] Connection successful:', {
        userId,
        socketId: client.id,
        timestamp: new Date().toISOString(),
      });
      client.emit('authenticated', { success: true, userId });
    } catch (error) {
      console.error('[handleConnection] Error occurred:', {
        socketId: client.id,
        error: error.message,
        stack: error.stack,
      });
      client.emit('error_response', { message: 'Connection failed' });
      client.disconnect();
    }
  }

  async handleDisconnect(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId;
    const now = new Date();
    console.log('[handleDisconnect] Client disconnecting:', {
      userId,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    try {
      if (userId) {
        if (typeof this.usersService.updateUserSocketInfo === 'function') {
          await this.usersService.updateUserSocketInfo(userId, {
            isOnline: false,
            socketConnected: false,
            lastSeen: now,
            $set: {
              'socketInfo.disconnectedAt': now,
              'socketInfo.lastActivity': now,
            },
          });
        }

        this.userSockets.delete(userId);
        console.log('[handleDisconnect] User socket removed:', { userId });

        // Clear pending invites (these should be cleared on disconnect)
        this.contentService.clearPendingInvites(userId);

        // Check if user is in a room and remove them on disconnect
        const existingRoom = this.contentService.getRoomByUserId(userId);
        if (existingRoom) {
          console.log('[handleDisconnect] User was in a room, removing from room:', {
            userId,
            roomId: existingRoom.roomId,
            participants: existingRoom.participants,
          });

          // Check if there's an active team game for this room
          const teamGameState = this.teamGames.get(existingRoom.roomId);
          let shouldContinueGame = false;

          // Check if disconnecting user is the inviter (admin) - first participant who created the game
          const normalizedUserId = this.normalizeId(userId);
          const isInviter = normalizedUserId && existingRoom.participants[0] === normalizedUserId;
          console.log('[handleDisconnect] Inviter check:', {
            userId: normalizedUserId,
            isInviter,
            firstParticipant: existingRoom.participants[0],
          });

          if (teamGameState) {
            // If inviter (admin) disconnects, always end the game
            if (isInviter) {
              await this.endTeamGame(teamGameState);
              this.server.to(existingRoom.roomId).emit('teamGameAborted', {
                message: 'Admin disconnected. Game ended.',
                roomId: existingRoom.roomId,
                userId,
              });
            } else {
              // Get game from database to check if it's a team game
              const gameModel = this.contentService.getGameModel();
              const game = await gameModel.findOne({ gameId: teamGameState.gameId }).lean().exec();

              if (game && game.gameMode === 'team' && normalizedUserId) {
                const remainingPlayers = teamGameState.players.filter(
                  (p) => this.normalizeId(p) !== normalizedUserId
                );

                // Count remaining teams after removing the player
                const remainingTeams = new Set<string>();
                remainingPlayers.forEach((playerId) => {
                  for (const [teamId, playerIds] of teamGameState.teams.entries()) {
                    if (playerIds.includes(playerId)) {
                      remainingTeams.add(teamId);
                    }
                  }
                });

                // If at least 2 teams remain, remove user and continue game
                if (remainingTeams.size >= 2) {
                  // Remove player from game state
                  teamGameState.players = remainingPlayers;
                  
                  // Remove player from their team
                  for (const [teamId, playerIds] of teamGameState.teams.entries()) {
                    const updatedPlayers = playerIds.filter(
                      (p) => this.normalizeId(p) !== normalizedUserId
                    );
                    if (updatedPlayers.length === 0) {
                      // Team has no players left, remove team
                      teamGameState.teams.delete(teamId);
                      teamGameState.teamScores.delete(teamId);
                    } else {
                      teamGameState.teams.set(teamId, updatedPlayers);
                    }
                  }

                  // Remove player's answers and scores
                  teamGameState.playerAnswers.delete(normalizedUserId);
                  teamGameState.playerWrongAnswers.delete(normalizedUserId);
                  teamGameState.eliminatedPlayers.delete(normalizedUserId);

                  // Update persistence
                  try {
                    await this.teamGameService.removePlayerFromGame(
                      teamGameState.gameId,
                      normalizedUserId,
                    );
                  } catch (error) {
                    console.error('[handleDisconnect] Failed to remove player from game in DB:', {
                      userId: normalizedUserId,
                      gameId: teamGameState.gameId,
                      error: error.message,
                    });
                  }

                  shouldContinueGame = true;

                  // Notify remaining players in room that a player disconnected but game continues
                  this.server.to(existingRoom.roomId).emit('teamPlayerLeftGame', {
                    message: 'A player disconnected from the game',
                    roomId: existingRoom.roomId,
                    gameId: teamGameState.gameId,
                    leavingUserId: userId,
                    remainingPlayers: remainingPlayers,
                    remainingTeams: Array.from(remainingTeams),
                    gameContinues: true,
                  });
                } else {
                  // End the game without awarding points and coins
                  await this.endTeamGame(teamGameState);

                  // Notify all players in room that game was aborted
                  this.server.to(existingRoom.roomId).emit('teamGameAborted', {
                    message: 'A player disconnected from the room',
                    roomId: existingRoom.roomId,
                    userId,
                  });
                }
              } else {
                // If game not found in DB or not a team game, end the game
                await this.endTeamGame(teamGameState);
                this.server.to(existingRoom.roomId).emit('teamGameAborted', {
                  message: 'A player disconnected from the room',
                  roomId: existingRoom.roomId,
                  userId,
                });
              }
            }
          }

          // Remove user from room (only delete room if game is not continuing)
          try {
            if (shouldContinueGame) {
              await this.contentService.removeUserFromRoomParticipants(existingRoom.roomId, userId);
            } else {
              await this.contentService.leaveUser(userId);
            }
            console.log('[handleDisconnect] User removed from room:', {
              userId,
              roomId: existingRoom.roomId,
              shouldContinueGame,
            });

            // Notify only the disconnecting user (not other participants)
            const userDisconnectedPayload = {
              userId,
              roomId: existingRoom.roomId,
              message: 'A user disconnected from the room',
            };

            // Emit only to the disconnecting user
            const normalizedDisconnectingUserId = this.normalizeId(userId);
            if (normalizedDisconnectingUserId) {
              const disconnectingUserSocket = this.userSockets.get(normalizedDisconnectingUserId);
              if (disconnectingUserSocket) {
                disconnectingUserSocket.emit('userDisconnected', userDisconnectedPayload);
              }
            }
          } catch (roomError) {
            console.error('[handleDisconnect] Error removing user from room:', {
              userId,
              roomId: existingRoom.roomId,
              error: roomError.message,
            });
          }
        }

        // if the user has an active single-player game, gracefully end it
        const game = this.activeGames.get(userId);
        if (game) {
          console.log('[handleDisconnect] Ending active single-player game:', {
            userId,
            gameId: game.gameId,
            score: game.score,
          });
          // send final summary to socket (if connected) and remove game
          try {
            game.socket.emit('GAME_ABORTED', {
              message: 'User disconnected',
              score: game.score,
            });
          } catch (e) {
            // ignore
          }
          this.activeGames.delete(userId);
        }
      } else {
        console.log('[handleDisconnect] No userId found for socket:', {
          socketId: client.id,
        });
      }
    } catch (error) {
      console.error('[handleDisconnect] Error occurred:', {
        userId,
        socketId: client.id,
        error: error.message,
        stack: error.stack,
      });
    }
  }

  // -------------------------------------------------------------
  // GET TEAM MEMBERS (ONLINE AND OFFLINE)
  // Returns both online and offline team members, with online users shown first
  // Client emits: getOnlineTeamMembers { teamId?: string, organizationId?: string }
  // -------------------------------------------------------------
  @SubscribeMessage('getTeamMembers')
  async getTeamMembers(
    @ConnectedSocket() client: Socket,
    @MessageBody() data?: { teamId?: string; organizationId?: string },
  ) {
    const userId = client.data.userId;
    console.log('[getTeamMembers] Event received:', {
      userId,
      data,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[getTeamMembers] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    try {
      const result = await this.teamGameService.getTeamMembers(
        data?.teamId,
        data?.organizationId,
      );
      client.emit('getTeamMembers', { success: true, result });
      return result;
    } catch (error) {
      console.error('[getTeamMembers] Error occurred:', {
        userId,
        error: error.message,
        stack: error.stack,
        data,
      });
      return client.emit('errorMessage', {
        message: error.message || 'Failed to get team members',
      });
    }
  }

  // -------------------------------------------------------------
  // CREATE SINGLE PLAYER GAME FOR TEAM MEMBER
  // Client emits: teamMemberCreateGame { subTopicId, difficulty? }
  // Same as singlePlayCreateGame from game.gateway.ts
  // -------------------------------------------------------------
  @SubscribeMessage('teamMemberCreateGame')
  async teamMemberCreateGame(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { subTopicId: string; difficulty?: string },
  ) {
    const userId = client.data.userId as string;
    console.log('[teamMemberCreateGame] Event received:', {
      userId,
      body,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[teamMemberCreateGame] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    // Check if user is blocked
    const { isBlocked } = await this.checkUserIsBlocked(userId);
    if (isBlocked) {
      console.log('[teamMemberCreateGame] Error: User account is blocked:', { userId });
      return client.emit('errorMessage', { message: 'Your account is blocked' });
    }

    // Check if user is online
    const isOnline = await this.checkUserIsOnline(userId);
    console.log('[teamMemberCreateGame] User online status:', { userId, isOnline });
    if (!isOnline) {
      console.log('[teamMemberCreateGame] Error: User is not online');
      return client.emit('errorMessage', {
        message: 'You must be online to play games. Please set your status to online.',
      });
    }

    const user = await this.usersService.findById(userId);

    if (!user) {
      console.log('[teamMemberCreateGame] Error: User not found:', { userId });
      return client.emit('errorMessage', { message: 'User not found' });
    }

    // Prevent duplicate game
    if (this.activeGames.has(userId)) {
      console.log('[teamMemberCreateGame] Error: Game already in progress:', { userId });
      return client.emit('errorMessage', {
        message: 'Game already in progress',
      });
    }

    const { subTopicId, difficulty = 'easy' } = body as {
      subTopicId: string;
      difficulty?: Difficulty;
    };

    if (!subTopicId) {
      console.log('[teamMemberCreateGame] Error: subTopicId is required');
      return client.emit('errorMessage', { message: 'subTopicId is required' });
    }

    console.log('[teamMemberCreateGame] Creating single-player game:', {
      userId,
      subTopicId,
      difficulty,
    });

    try {
      const {
        gameId,
        questions,
        topicId,
        subTopicId: normalizedSubTopicId,
        subTopicIndex,
        totalSubTopics,
        deckId,
        deckName,
      } = await this.teamGameService.teamMemberCreateGame(
        userId,
        subTopicId,
        difficulty,
      );

      if (!Array.isArray(questions) || questions.length === 0) {
        return client.emit('errorMessage', {
          message: 'No questions available for this topic',
        });
      }

      // Safely read user's current coin balance (if available)
      const userCoins =
        typeof (user as any)?.coins === 'number' && Number.isFinite((user as any).coins)
          ? (user as any).coins
          : 0;

      const gameState: GameState = {
        gameId,
        userId,
        subTopicId: normalizedSubTopicId,
        deckId: deckId,
        socket: client,
        questions,
        currentIndex: 0,
        lives: Number.isInteger(user.lives) && user.lives > 0 ? user.lives : 0,
        score: 0,
        answers: [],
        startedAt: new Date(),
        isCorrect: false,
      };
      this.activeGames.set(userId, gameState);

      console.log('[teamMemberCreateGame] Game created successfully:', {
        gameId: gameState.gameId,
        userId,
        totalQuestions: questions.length,
        lives: gameState.lives,
        topicId,
        subTopicId: normalizedSubTopicId,
      });

      client.emit('gameStart', {
        gameId: gameState.gameId,
        totalQuestions: questions.length,
        lives: gameState.lives,
        timePerQuestion: QUESTION_TIME_SECONDS,
        topicId,
        subTopicId: normalizedSubTopicId,
        subTopicIndex,
        totalSubTopics,
        deckId: deckId ?? null,
        deckName: deckName ?? null,
        coins: userCoins,
        questions,
      });
      console.log('[teamMemberCreateGame] Game start event emitted');
    } catch (err) {
      console.error('[teamMemberCreateGame] Error occurred:', {
        userId,
        error: err.message,
        stack: err.stack,
        body,
      });
      client.emit('errorMessage', { message: 'Failed to start game' });
    }
  }

  // -------------------------------------------------------------
  // SEARCH TEAM MEMBERS BY NAME (ONLINE AND OFFLINE)
  // Returns both online and offline team members matching the name, with online users shown first
  // Client emits: searchTeamMembersName { name: string, teamId?: string, organizationId?: string }
  // -------------------------------------------------------------
  @SubscribeMessage('searchTeamMembersName')
  async searchTeamMembersName(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: {
      name: string;
      teamId?: string;
      organizationId?: string;
    },
  ) {
    const userId = client.data.userId;
    console.log('[searchTeamMembersName] Event received:', {
      userId,
      data,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[searchTeamMembersName] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    const searchTerm = data?.name?.trim();
    if (!searchTerm) {
      console.log('[searchTeamMembersName] Error: name is required for search');
      return client.emit('errorMessage', {
        message: 'name is required for search',
      });
    }

    try {
      const users = await this.teamGameService.searchTeamMembersName(
        searchTerm,
        userId,
        data?.teamId,
        data?.organizationId,
      );
      client.emit('searchTeamMembersName', { success: true, users });
    } catch (error) {
      console.error('[searchTeamMembersName] Error occurred:', {
        userId,
        error: error.message,
        stack: error.stack,
        data,
      });
      client.emit('errorMessage', {
        message: error.message || 'Failed to search team members',
      });
    }
  }

  // -------------------------------------------------------------
  // SEARCH DECKS BY NAME (PARTIAL MATCH, CASE-INSENSITIVE)
  // Client emits: searchDeckName { searchTerm: string, limit?: number }
  // -------------------------------------------------------------
  @SubscribeMessage('searchDeckName')
  async searchDeckName(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { deckName: string; limit?: number },
  ) {
    const userId = client.data.userId;
    console.log('[searchDeckName] Event received:', {
      userId,
      data,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[searchDeckName] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    const term = data?.deckName?.trim();
    if (!term) {
      console.log('[searchDeckName] Error: deckName is required');
      return client.emit('errorMessage', {
        message: 'deckName is required',
      });
    }

    try {
      const decks = await this.teamGameService.searchDeckName(
        term,
        data?.limit,
      );
      client.emit('searchDeckName', { success: true, decks });
    } catch (error) {
      console.error('[searchDeckName] Error occurred:', {
        userId,
        error: error.message,
        stack: error.stack,
        data,
      });
      client.emit('errorMessage', {
        message: error?.message || 'Failed to search decks',
      });
    }
  }

  // -------------------------------------------------------------
  // TEAM GAME CHAT - SEND MESSAGE
  // Client emits: teamGameSendMessage { gameId, teamId, message }
  // Stores message with organizationId and delivers to all team members only
  // Host (inviter/admin) cannot send or view messages
  // -------------------------------------------------------------
  @SubscribeMessage('teamGameSendMessage')
  async handleTeamGameSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { gameId: string; teamId: string; message: string },
  ) {
    const userId = client.data.userId;
    console.log('[teamGameSendMessage] Event received:', {
      userId,
      data,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[teamGameSendMessage] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    const trimmedMessage = data?.message?.trim();
    if (!data?.gameId || !data?.teamId || !trimmedMessage) {
      console.log('[teamGameSendMessage] Error: gameId, teamId and message are required');
      return client.emit('errorMessage', {
        message: 'gameId, teamId and message are required',
      });
    }

    try {
      const normalizedUserId = this.normalizeId(userId);
      if (!normalizedUserId) {
        return client.emit('errorMessage', {
          message: 'Invalid user ID',
        });
      }

      // Get room by gameId (gameId = roomId when invite is accepted)
      const room = this.contentService.getRoomByRoomId(data.gameId);
      if (!room?.roomId) {
        return client.emit('errorMessage', {
          message: 'Game room not found',
        });
      }

      // Check if user is a participant in the room
      const participants = room.participants || [];
      if (participants.length === 0) {
        return client.emit('errorMessage', {
          message: 'Room has no participants',
        });
      }

      // Check if sender is the inviter/host - host cannot send messages
      // First participant is always the inviter/host
      const normalizedInviterId = this.normalizeId(participants[0]);
      
      if (normalizedUserId === normalizedInviterId) {
        console.log('[teamGameSendMessage] Error: Host cannot send messages');
        return client.emit('errorMessage', {
          message: 'Host can only view the game, not send messages',
        });
      }
      const normalizedParticipants = participants
        .map((p) => this.normalizeId(p))
        .filter((id): id is string => id !== null);

      if (!normalizedParticipants.includes(normalizedUserId)) {
        return client.emit('errorMessage', {
          message: 'You are not a participant in this room',
        });
      }

      // Get team memberships to find which team the user belongs to
      const teamMembers = await this.teamMemberModel
        .find({
          user: normalizedUserId,
          team: data.teamId,
          status: 'approved',
        })
        .lean()
        .exec();

      if (teamMembers.length === 0) {
        return client.emit('errorMessage', {
          message: 'You are not a member of this team',
        });
      }

      // Check if game has started (teamGameState exists)
      const teamGameState = this.teamGames.get(room.roomId);
      
      // If game has started, validate user is a player
      if (teamGameState) {
        if (!teamGameState.players.includes(normalizedUserId)) {
          return client.emit('errorMessage', {
            message: 'You are not a player in this game',
          });
        }
      }

      // Save message to database
      const saved = await this.teamGameService.addTeamGameChatMessage({
        userId,
        teamId: data.teamId,
        gameId: data.gameId,
        message: trimmedMessage,
      });

      // Get user's name and profileImage
      let userName = '';
      let userProfileImage: string | null = null;
      try {
        const user = await this.usersService.findById(normalizedUserId);
        if (user) {
          userName = (user as any)?.name || (user as any)?.username || '';
          userProfileImage = (user as any)?.profileImage || null;
        }
      } catch (error) {
        console.warn('[teamGameSendMessage] Failed to fetch user info:', error);
        // Continue with empty values if fetch fails
      }

      const payload = {
        gameId: saved.gameId,
        teamId: saved.teamId,
        userId: saved.userId,
        organizationId: saved.organizationId,
        message: saved.message,
        createdAt: saved.createdAt,
        name: userName,
        profileImage: userProfileImage,
      };

      // Get recipients: team members who are participants in the room (excluding host)
      const recipients = new Set<string>();
      
      if (teamGameState) {
        // If game has started, use teamGameState.teams
        const teamPlayerIds = teamGameState.teams.get(data.teamId) || [];
        teamPlayerIds.forEach((playerId) => {
          const normalizedPlayerId = this.normalizeId(playerId);
          if (normalizedPlayerId && normalizedPlayerId !== normalizedInviterId) {
            recipients.add(normalizedPlayerId);
          }
        });
      } else {
        // If game hasn't started, get team members from database who are in the room
        const allTeamMembers = await this.teamMemberModel
          .find({
            team: data.teamId,
            status: 'approved',
          })
          .lean()
          .exec();

        allTeamMembers.forEach((tm) => {
          const memberId = this.normalizeId(tm.user);
          if (memberId && normalizedParticipants.includes(memberId) && memberId !== normalizedInviterId) {
            recipients.add(memberId);
          }
        });
      }

      // Send message only to team members (excluding host)
      recipients.forEach((memberId) => {
        const socket = this.userSockets.get(memberId);
        if (socket) {
          socket.emit('teamGameMessage', payload);
        }
      });

      // Acknowledge sender
      client.emit('teamGameMessageSent', { success: true, message: payload });
    } catch (error) {
      console.error('[teamGameSendMessage] Error occurred:', {
        userId,
        error: error.message,
        stack: error.stack,
        data,
      });
      client.emit('errorMessage', {
        message: error?.message || 'Failed to send message',
      });
    }
  }

  // -------------------------------------------------------------
  // INVITE TEAM USER
  // Client emits: inviteTeamUser { teamId: string[], mode?: 'Regular' | 'Knockout', deckId?: string, topicId?: string }
  // Sends invites to all online users in the specified teams
  // If inviter already has a room, only sends invites to NEW team members
  // -------------------------------------------------------------
  @SubscribeMessage('inviteTeamUser')
  async inviteTeamUser(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { teamId: string[]; mode?: 'Regular' | 'Knockout'; deckId?: string; topicId?: string },
  ) {
    const inviterId = client.data.userId;
    console.log('[inviteTeamUser] Event received:', {
      inviterId,
      data,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!inviterId) {
      console.log('[inviteTeamUser] Error: Unauthorized - no inviterId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    // Check if user is blocked
    const { isBlocked } = await this.checkUserIsBlocked(inviterId);
    if (isBlocked) {
      console.log('[inviteTeamUser] Error: User account is blocked:', { inviterId });
      return client.emit('errorMessage', { message: 'Your account is blocked' });
    }

    const { teamId, mode } = data;
    if (!teamId || !Array.isArray(teamId) || teamId.length === 0) {
      console.log('[inviteTeamUser] Error: teamId array is required and must not be empty');
      return client.emit('errorMessage', {
        message: 'teamId array is required and must not be empty',
      });
    }

    // Validate and normalize mode
    const validMode = mode && (mode === 'Regular' || mode === 'Knockout') ? mode : undefined;
    if (mode && !validMode) {
      console.log('[inviteTeamUser] Warning: Invalid mode provided, ignoring:', { mode });
    }

    try {
      // Check if user has superAdmin or admin userType
      const inviter = await this.userModel.findById(inviterId).exec();
      if (!inviter) {
        return client.emit('errorMessage', {
          message: 'User not found',
        });
      }

      const normalizedInviterId = this.normalizeId(inviterId);
      if (!normalizedInviterId) {
        return client.emit('errorMessage', {
          message: 'Invalid inviter ID',
        });
      }

      const userType = inviter.userType;

      if (userType !== 'superAdmin' && userType !== 'admin') {
        return client.emit('errorMessage', {
          message: 'Only superAdmin or admin users can send team invites',
        });
      }

      // Check if inviter already has an active room
      const existingRoom = this.contentService.getRoomByUserId(normalizedInviterId);
      const existingRoomId = existingRoom?.roomId || undefined;
      const existingParticipants = existingRoom?.participants || [];
      
      console.log('[inviteTeamUser] Room check:', {
        hasExistingRoom: !!existingRoom,
        existingRoomId,
        existingParticipantsCount: existingParticipants.length,
        existingParticipants,
      });

      // Collect all team members from all teams
      const allTeamMembersMap = new Map<string, any>(); // Use Map to track unique members by ID
      
      for (const singleTeamId of teamId) {
        if (!singleTeamId) {
          continue; // Skip invalid team IDs
        }
        
        // Get all team members (online and offline) for this team
        const teamMembers = await this.teamGameService.getTeamMembers(singleTeamId);
        
        // Add to map (will automatically handle duplicates if user is in multiple teams)
        teamMembers.forEach((member: any) => {
          const memberId = this.normalizeId(member._id);
          if (memberId && !allTeamMembersMap.has(memberId)) {
            allTeamMembersMap.set(memberId, member);
          }
        });
      }

      // Filter to only online users and exclude the inviter
      const onlineTeamMembers = Array.from(allTeamMembersMap.values()).filter((member: any) => {
        const memberId = this.normalizeId(member._id);
        return (
          member.isOnline === true &&
          memberId !== normalizedInviterId
        );
      });

      if (onlineTeamMembers.length === 0) {
        return client.emit('errorMessage', {
          message: 'No online team members available to invite',
        });
      }

      // Extract user IDs from online team members
      const allOnlineUserIds = onlineTeamMembers.map((member: any) =>
        this.normalizeId(member._id),
      ).filter((id): id is string => id !== null);

      // Filter out users who are already participants in the room (if room exists)
      const newUserIdsToInvite = existingRoom
        ? allOnlineUserIds.filter((userId) => !existingParticipants.includes(userId))
        : allOnlineUserIds;

      console.log('[inviteTeamUser] Invite filtering:', {
        totalOnlineMembers: allOnlineUserIds.length,
        alreadyInRoom: existingParticipants.length,
        newUsersToInvite: newUserIdsToInvite.length,
        newUserIds: newUserIdsToInvite,
      });

      if (newUserIdsToInvite.length === 0) {
        return client.emit('errorMessage', {
          message: 'All team members are already invited or in the room',
        });
      }

      // Send invites to only NEW online team members (use existing roomId if room exists)
      // Pass the mode to inviteUserToGame so it can emit the correct event (teamGameInvite for Regular/Knockout)
      const invite = await this.contentService.inviteUserToGame(inviterId, {
        userIds: newUserIdsToInvite,
        gameId: existingRoomId || undefined, // Pass existing roomId to reuse the same room (convert null to undefined)
        gameMode: validMode || undefined, // Pass the mode so content.service emits teamGameInvite for Regular/Knockout
        deckId: data.deckId || undefined,
        topicId: data.topicId || undefined,
      });

      // Handle both single invite (backward compatibility) and multiple invites
      const invites = Array.isArray(invite) ? invite : [invite];

      // Remove gameMode field from invite objects for inviteTeamUserResponse
      const removeGameMode = (inv: any) => {
        const { gameMode, ...inviteWithoutGameMode } = inv;
        return inviteWithoutGameMode;
      };

      const processedInvites = invites.map(removeGameMode);
      const processedInvite = Array.isArray(invite)
        ? processedInvites
        : processedInvites[0];

      // Get inviter's name
      let inviterName = '';
      try {
        inviterName = (inviter as any)?.name || (inviter as any)?.username || '';
      } catch (error) {
        // If unable to get name, leave it empty
        inviterName = '';
      }

      // Fetch deck and topic names if deckId and topicId are provided
      let deckName: string | null = null;
      let topicName: string | null = null;
      
      if (data.deckId) {
        try {
          const normalizedDeckId = this.normalizeId(data.deckId);
          if (normalizedDeckId) {
            const deck = await this.deckModel.findById(normalizedDeckId).select('name').lean().exec();
            if (deck) {
              deckName = (deck as any)?.name || null;
            }
          }
        } catch (error) {
          console.warn('[inviteTeamUser] Failed to fetch deck name:', error);
        }
      }
      
      if (data.topicId) {
        try {
          const normalizedTopicId = this.normalizeId(data.topicId);
          if (normalizedTopicId) {
            const topic = await this.topicModel.findById(normalizedTopicId).select('title').lean().exec();
            if (topic) {
              topicName = (topic as any)?.title || null;
            }
          }
        } catch (error) {
          console.warn('[inviteTeamUser] Failed to fetch topic name:', error);
        }
      }

      // Send inviteTeamUserResponse to each NEWLY invited team member with only their own invite
      // Each user should only see their own invite, not all invites
      // Only send to users who were actually invited (newUserIdsToInvite)
      newUserIdsToInvite.forEach((memberId) => {
        // Find the specific invite for this member (use original invite, not processed)
        const originalInvite = invites.find(
          (inv: any) => this.normalizeId(inv.toUserId) === memberId
        );
        const processedInvite = processedInvites.find(
          (inv: any) => this.normalizeId(inv.toUserId) === memberId
        );

        if (originalInvite && processedInvite) {
          const memberSocket = this.userSockets.get(memberId);
          if (memberSocket) {
            // Send only this member's invite along with inviterName, mode, deckId, deckName, topicId, topicName
            const memberInviteResponse = {
              ...processedInvite,
              inviterName: inviterName,
              mode: validMode || undefined, // Include validated mode if provided
              deckId: data.deckId || undefined,
              deckName: deckName || undefined,
              topicId: data.topicId || undefined,
              topicName: topicName || undefined,
            };
            memberSocket.emit('inviteTeamUserResponse', memberInviteResponse);
            
            // Note: teamGameInvite event is already emitted by content.service.inviteUserToGame
            // when mode is 'Regular' or 'Knockout'. No need to emit it manually here.
          }
        }
      });

      // Return success response to inviter with room info
      const finalRoomId = existingRoomId || (Array.isArray(invite) && invite.length > 0 ? invite[0].gameId : undefined);
      client.emit('inviteTeamUserSuccess', {
        success: true,
        roomId: finalRoomId || null,
        newInvitesCount: newUserIdsToInvite.length,
        totalParticipants: existingRoom ? existingRoom.participants.length + newUserIdsToInvite.length : newUserIdsToInvite.length + 1, // +1 for inviter
      });
    } catch (error) {
      console.error('[inviteTeamUser] Error occurred:', {
        inviterId,
        error: error.message,
        stack: error.stack,
        data,
      });
      client.emit('errorMessage', {
        message: error?.message || 'Failed to send team invites',
      });
    }
  }

  // -------------------------------------------------------------
  // ACCEPT TEAM INVITE
  // Client emits: acceptTeamInvite { userId: string, deviceId?: string, gameId?: string }
  // Accepts a team invite to join a game
  // -------------------------------------------------------------
  @SubscribeMessage('acceptTeamInvite')
  async acceptTeamInvite(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId?: string; deviceId?: string; gameId?: string },
  ) {
    const acceptorId = client.data.userId;
    console.log('[acceptTeamInvite] Event received:', {
      acceptorId,
      data,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!acceptorId) {
      console.log('[acceptTeamInvite] Error: Unauthorized - no acceptorId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    // Declare normalizedAcceptorId at function scope to avoid redeclaration issues
    const normalizedAcceptorId = this.normalizeId(acceptorId);

    try {
      // For team invites, we don't need userId in data - it will be found from pending invites
      // If userId is provided but it's the acceptor's own ID, we'll ignore it and find from invite
      const providedUserId = data?.userId ? this.normalizeId(data.userId) : null;
      
      // If provided userId is the same as acceptor, don't pass it (will be found from invite)
      // Only include userId if it's different from acceptor (i.e., it's the inviter ID)
      const acceptData: { userId?: string; deviceId?: string; gameId?: string } = {
        deviceId: data?.deviceId,
        gameId: data?.gameId,
      };
      
      if (providedUserId && providedUserId !== normalizedAcceptorId) {
        acceptData.userId = data.userId;
      }
      
      const room = await this.contentService.acceptInvite(acceptorId, acceptData);

      // Get all participants from the room
      const activeRoom = this.contentService.getRoomByRoomId(room.roomId);
      const participants = activeRoom?.participants || [room.inviterId, room.inviteeId];

      // Join all participants to the room
      participants.forEach((participantId) => {
        const participantSocket = this.userSockets.get(participantId);
        if (participantSocket) {
          participantSocket.join(room.roomId);
        }
      });

      // Get acceptor's name and profile image for inviter to see who accepted
      let acceptorName = '';
      let acceptorProfileImage: string | null = null;
      try {
        const acceptor = await this.usersService.findById(acceptorId);
        acceptorName = (acceptor as any)?.name || (acceptor as any)?.username || '';
        acceptorProfileImage = (acceptor as any)?.profileImage || null;
      } catch (error) {
        // If unable to get name/profile image, leave it empty
        acceptorName = '';
        acceptorProfileImage = null;
      }

      // Get host ID (first participant)
      const hostId = this.normalizeId(participants[0]);

      // Normalize all participant IDs
      const normalizedParticipants = participants
        .map((p) => this.normalizeId(p))
        .filter((id): id is string => id !== null);

      // Get team memberships for all participants
      const teamMembers = await this.teamMemberModel
        .find({
          user: { $in: normalizedParticipants },
          status: 'approved', // Only approved team members
        })
        .lean()
        .exec();

      // Create a map of userId -> teamId
      const userTeamMap = new Map<string, string>();
      teamMembers.forEach((tm) => {
        const userId = this.normalizeId(tm.user);
        const teamId = this.normalizeId(tm.team);
        if (userId && teamId) {
          userTeamMap.set(userId, teamId);
        }
      });

      // Get all unique team IDs
      const teamIds = Array.from(new Set(userTeamMap.values()));
      
      // Fetch team details (teamName) for all teams
      const teamsInfoMap = new Map<string, { teamId: string; teamName: string }>();
      if (teamIds.length > 0) {
        const teams = await this.teamModel
          .find({ _id: { $in: teamIds } })
          .select('_id teamName')
          .lean()
          .exec();
        teams.forEach((team: any) => {
          const teamId = this.normalizeId(team._id);
          if (teamId) {
            teamsInfoMap.set(teamId, {
              teamId: teamId,
              teamName: (team as any)?.teamName || '',
            });
          }
        });
      }

      // Calculate team member counts (how many participants in the room belong to each team)
      const teamMemberCounts: Record<string, number> = {};
      normalizedParticipants.forEach((participantId) => {
        const teamId = userTeamMap.get(participantId);
        if (teamId) {
          teamMemberCounts[teamId] = (teamMemberCounts[teamId] || 0) + 1;
        }
      });

      // Fetch all participant details (name, profileImage, isHost, teamId, teamName)
      const participantDetails: Array<{
        userId: string;
        name: string;
        profileImage: string | null;
        isHost: boolean;
        teamId?: string;
        teamName?: string;
      }> = [];

      await Promise.all(
        participants.map(async (participantId) => {
          const normalizedId = this.normalizeId(participantId);
          if (!normalizedId) return;

          try {
            const participant = await this.usersService.findById(normalizedId);
            const userName = (participant as any)?.name || (participant as any)?.username || '';
            const userProfileImage = (participant as any)?.profileImage || null;
            const isHost = normalizedId === hostId;

            // Get team information for this participant
            const participantTeamId = userTeamMap.get(normalizedId);
            const teamInfo = participantTeamId ? teamsInfoMap.get(participantTeamId) : null;

            participantDetails.push({
              userId: normalizedId,
              name: userName,
              profileImage: userProfileImage,
              isHost: isHost,
              teamId: participantTeamId || undefined,
              teamName: teamInfo?.teamName || undefined,
            });

            console.log('[acceptTeamInvite] Participant details fetched:', {
              userId: normalizedId,
              name: userName,
              hasProfileImage: !!userProfileImage,
              isHost,
              teamId: participantTeamId,
              teamName: teamInfo?.teamName,
            });
          } catch (error) {
            console.warn('[acceptTeamInvite] Failed to fetch participant info:', {
              participantId: normalizedId,
              error: error.message,
            });
            // Get team information even if user fetch fails
            const participantTeamId = userTeamMap.get(normalizedId);
            const teamInfo = participantTeamId ? teamsInfoMap.get(participantTeamId) : null;
            // Add participant with default values
            participantDetails.push({
              userId: normalizedId,
              name: '',
              profileImage: null,
              isHost: normalizedId === hostId,
              teamId: participantTeamId || undefined,
              teamName: teamInfo?.teamName || undefined,
            });
          }
        }),
      );

      // Notify all participants in room that invite was accepted
      const inviteAcceptedPayload = {
        roomId: room.roomId,
        inviterId: room.inviterId,
        inviteeId: room.inviteeId,
        deviceId: room.deviceId,
        gameId: room.gameId,
        participants: participants, // Include all participants in the response
        acceptorName: acceptorName, // Add acceptor's name so inviter can see who accepted
        acceptorProfileImage: acceptorProfileImage, // Add acceptor's profile image so inviter can see who accepted
      };
      console.log('[acceptTeamInvite] Emitting teamInviteAccepted to room:', {
        roomId: room.roomId,
        payload: inviteAcceptedPayload,
        participants,
      });
      // Emit to room, not globally - ensures only users in the room receive it
      this.server.to(room.roomId).emit('teamInviteAccepted', inviteAcceptedPayload);

      // Emit inviteTeamMemberAccepted to the admin (inviter) who sent the invite
      // Format matches the specification: invitesendId, inviteaccpetId
      const normalizedInviterId = this.normalizeId(room.inviterId);
      // normalizedAcceptorId already declared above
      
      if (normalizedInviterId) {
        const inviterSocket = this.userSockets.get(normalizedInviterId);
        if (inviterSocket) {
          const inviteTeamMemberAcceptedPayload = {
            roomId: room.roomId,
            invitesendId: normalizedInviterId, // Admin who sent the invite
            inviteaccpetId: normalizedAcceptorId, // User who accepted
            deviceId: room.deviceId,
            gameId: room.gameId,
            participants: participants,
            acceptorName: acceptorName,
            acceptorProfileImage: acceptorProfileImage,
          };
          console.log('[acceptTeamInvite] Emitting inviteTeamMemberAccepted to admin:', {
            inviterId: normalizedInviterId,
            acceptorId: normalizedAcceptorId,
            payload: inviteTeamMemberAcceptedPayload,
          });
          inviterSocket.emit('inviteTeamMemberAccepted', inviteTeamMemberAcceptedPayload);
        } else {
          console.warn('[acceptTeamInvite] Inviter socket not found:', {
            inviterId: normalizedInviterId,
            availableSockets: Array.from(this.userSockets.keys()),
          });
        }
      }

      // Get deck and topic information from active room
      let deckId: string | undefined = undefined;
      let deckName: string | undefined = undefined;
      let topicId: string | undefined = undefined;
      let topicName: string | undefined = undefined;
      
      
      if (activeRoom) {
        const roomDeckId = (activeRoom as any).deckId;
        const roomTopicId = (activeRoom as any).topicId;
        
        if (roomDeckId) {
          deckId = this.normalizeId(roomDeckId) || undefined;
          if (deckId) {
            try {
              const deck = await this.deckModel.findById(deckId).select('name').lean().exec();
              if (deck) {
                deckName = (deck as any)?.name || undefined;
              }
            } catch (error) {
              console.warn('[acceptTeamInvite] Failed to fetch deck name:', error);
            }
          }
        }
        
        if (roomTopicId) {
          topicId = this.normalizeId(roomTopicId) || undefined;
          if (topicId) {
            try {
              const topic = await this.topicModel.findById(topicId).select('title').lean().exec();
              if (topic) {
                topicName = (topic as any)?.title || undefined;
              }
            } catch (error) {
              console.warn('[acceptTeamInvite] Failed to fetch topic name:', error);
            }
          }
        }
      }

      // Emit roomDetails event with full room details and participant info
      // Format matches the specification: invitsendId, invitaccpetedId
      // Reuse normalizedInviterId and normalizedAcceptorId from above
      // Determine mode (Regular | Knockout) from active room or room object if available
      const mode = (activeRoom && ((activeRoom as any).gameMode || (activeRoom as any).mode)) ||
        ((room as any)?.gameMode || (room as any)?.mode) || undefined;

      const roomDetailsPayload: any = {
        roomId: room.roomId,
        invitsendId: normalizedInviterId, // Admin who sent the invite
        invitaccpetedId: normalizedAcceptorId, // Current user who accepted
        deviceId: room.deviceId,
        gameId: room.gameId,
        participants: participantDetails, // Array of participants with name, profileImage, isHost, teamId, teamName
        teamMemberCount: teamMemberCounts, // Count of members in each team in the room
        mode: mode,
      };
      
      // Add deck and topic information if available
      if (deckId) {
        roomDetailsPayload.deckId = deckId;
      }
      if (deckName) {
        roomDetailsPayload.deckName = deckName;
      }
      if (topicId) {
        roomDetailsPayload.topicId = topicId;
      }
      if (topicName) {
        roomDetailsPayload.topicName = topicName;
      }
      console.log('[acceptTeamInvite] Emitting roomDetails to room:', {
        roomId: room.roomId,
        payload: roomDetailsPayload,
        participantCount: participantDetails.length,
        teamMemberCounts,
      });
      this.server.to(room.roomId).emit('roomDetails', roomDetailsPayload);

      console.log('[acceptTeamInvite] Team invite accepted process completed successfully');
    } catch (error) {
      console.error('[acceptTeamInvite] Error occurred:', {
        acceptorId,
        error: error.message,
        stack: error.stack,
        data,
      });
      client.emit('errorMessage', {
        message: error?.message || 'Failed to accept team invite',
      });
    }
  }

  // -------------------------------------------------------------
  // CANCEL TEAM INVITE
  // Client emits: cancelTeamInvite { gameId?: string, inviterId: string }
  // Cancels a team invite
  // -------------------------------------------------------------
  @SubscribeMessage('cancelTeamInvite')
  async cancelTeamInvite(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { gameId?: string; inviterId: string },
  ) {
    const userId = client.data.userId;
    console.log('[cancelTeamInvite] Event received:', {
      userId,
      data,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[cancelTeamInvite] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    try {
      const result = await this.contentService.cancelInvite(userId, data);
      client.emit('cancelTeamInviteResponse', {
        success: true,
        result,
      });
      
      // Get room details after cancel to emit updated roomDetails
      let roomId = data.gameId;
      if (!roomId) {
        // Try to get roomId from the room
        const room = this.contentService.getRoomByUserId(userId);
        roomId = room?.roomId;
      }

      // Emit to room if gameId is provided, otherwise emit to inviter only
      if (data.gameId) {
        this.server.to(data.gameId).emit('teamInviteCanceled', {
          inviterId: data.inviterId,
          gameId: data.gameId,
        });
      } else {
        // Notify inviter about canceled invite
        const inviterSocket = this.userSockets.get(data.inviterId);
        if (inviterSocket) {
          inviterSocket.emit('teamInviteCanceled', {
            inviterId: data.inviterId,
            gameId: data.gameId,
          });
        }
      }

      // Emit updated roomDetails after cancel (if room exists)
      if (roomId) {
        const activeRoom = this.contentService.getRoomByRoomId(roomId);
        if (activeRoom) {
          const participants = activeRoom.participants || [];
          const normalizedParticipants = participants
            .map((p) => this.normalizeId(p))
            .filter((id): id is string => id !== null);

          // Get team memberships for all participants
          const teamMembers = await this.teamMemberModel
            .find({
              user: { $in: normalizedParticipants },
              status: 'approved',
            })
            .lean()
            .exec();

          // Create a map of userId -> teamId
          const userTeamMap = new Map<string, string>();
          teamMembers.forEach((tm) => {
            const participantUserId = this.normalizeId(tm.user);
            const participantTeamId = this.normalizeId(tm.team);
            if (participantUserId && participantTeamId) {
              userTeamMap.set(participantUserId, participantTeamId);
            }
          });

          // Get all unique team IDs
          const teamIds = Array.from(new Set(userTeamMap.values()));
          
          // Fetch team details (teamName) for all teams
          const teamsInfoMap = new Map<string, { teamId: string; teamName: string }>();
          if (teamIds.length > 0) {
            const teams = await this.teamModel
              .find({ _id: { $in: teamIds } })
              .select('_id teamName')
              .lean()
              .exec();
            teams.forEach((team: any) => {
              const teamId = this.normalizeId(team._id);
              if (teamId) {
                teamsInfoMap.set(teamId, {
                  teamId: teamId,
                  teamName: (team as any)?.teamName || '',
                });
              }
            });
          }

          // Calculate team member counts
          const teamMemberCounts: Record<string, number> = {};
          normalizedParticipants.forEach((participantId) => {
            const participantTeamId = userTeamMap.get(participantId);
            if (participantTeamId) {
              teamMemberCounts[participantTeamId] = (teamMemberCounts[participantTeamId] || 0) + 1;
            }
          });

          // Get host ID (first participant)
          const hostId = this.normalizeId(participants[0]);

          // Fetch all participant details
          const participantDetails: Array<{
            userId: string;
            name: string;
            profileImage: string | null;
            isHost: boolean;
            teamId?: string;
            teamName?: string;
          }> = [];

          await Promise.all(
            participants.map(async (participantId) => {
              const normalizedId = this.normalizeId(participantId);
              if (!normalizedId) return;

              try {
                const participant = await this.usersService.findById(normalizedId);
                const userName = (participant as any)?.name || (participant as any)?.username || '';
                const userProfileImage = (participant as any)?.profileImage || null;
                const isHost = normalizedId === hostId;

                // Get team information for this participant
                const participantTeamId = userTeamMap.get(normalizedId);
                const teamInfo = participantTeamId ? teamsInfoMap.get(participantTeamId) : null;

                participantDetails.push({
                  userId: normalizedId,
                  name: userName,
                  profileImage: userProfileImage,
                  isHost: isHost,
                  teamId: participantTeamId || undefined,
                  teamName: teamInfo?.teamName || undefined,
                });
              } catch (error) {
                // Get team information even if user fetch fails
                const participantTeamId = userTeamMap.get(normalizedId);
                const teamInfo = participantTeamId ? teamsInfoMap.get(participantTeamId) : null;
                participantDetails.push({
                  userId: normalizedId,
                  name: '',
                  profileImage: null,
                  isHost: normalizedId === hostId,
                  teamId: participantTeamId || undefined,
                  teamName: teamInfo?.teamName || undefined,
                });
              }
            }),
          );

          const normalizedInviterId = this.normalizeId(activeRoom.participants[0]);
          
          // Get deck and topic information from active room
          let deckId: string | undefined = undefined;
          let deckName: string | undefined = undefined;
          let topicId: string | undefined = undefined;
          let topicName: string | undefined = undefined;
          
          const roomDeckId = (activeRoom as any).deckId;
          const roomTopicId = (activeRoom as any).topicId;
          
          if (roomDeckId) {
            deckId = this.normalizeId(roomDeckId) || undefined;
            if (deckId) {
              try {
                const deck = await this.deckModel.findById(deckId).select('name').lean().exec();
                if (deck) {
                  deckName = (deck as any)?.name || undefined;
                }
              } catch (error) {
                console.warn('[cancelTeamInvite] Failed to fetch deck name:', error);
              }
            }
          }
          
          if (roomTopicId) {
            topicId = this.normalizeId(roomTopicId) || undefined;
            if (topicId) {
              try {
                const topic = await this.topicModel.findById(topicId).select('title').lean().exec();
                if (topic) {
                  topicName = (topic as any)?.title || undefined;
                }
              } catch (error) {
                console.warn('[cancelTeamInvite] Failed to fetch topic name:', error);
              }
            }
          }
          
          const roomDetailsPayload: any = {
            roomId: roomId,
            invitsendId: normalizedInviterId,
            invitaccpetedId: normalizedInviterId, // Use inviterId as default since this is after cancel
            deviceId: activeRoom.deviceId,
            gameId: roomId,
            participants: participantDetails,
            teamMemberCount: teamMemberCounts,
          };
          
          // Add deck and topic information if available
          if (deckId) {
            roomDetailsPayload.deckId = deckId;
          }
          if (deckName) {
            roomDetailsPayload.deckName = deckName;
          }
          if (topicId) {
            roomDetailsPayload.topicId = topicId;
          }
          if (topicName) {
            roomDetailsPayload.topicName = topicName;
          }

          // Include mode if available on activeRoom
          const cancelMode = ((activeRoom as any)?.gameMode || (activeRoom as any)?.mode) || undefined;
          if (cancelMode) {
            roomDetailsPayload.mode = cancelMode;
          }
          this.server.to(roomId).emit('roomDetails', roomDetailsPayload);
        }
      }
    } catch (error) {
      console.error('[cancelTeamInvite] Error occurred:', {
        userId,
        error: error.message,
        stack: error.stack,
        data,
      });
      client.emit('errorMessage', {
        message: error?.message || 'Failed to cancel team invite',
      });
    }
  }

  // -------------------------------------------------------------
  // USER LEFT TEAM GAME
  // Client emits: teamUserLeft { gameId: string, userId?: string }
  // Removes the user from in-memory state and active room
  // -------------------------------------------------------------
  @SubscribeMessage('teamUserLeft')
  async handleTeamUserLeft(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { gameId: string; userId?: string },
  ) {
    const requesterId = client.data.userId;
    console.log('[teamUserLeft] Event received:', {
      requesterId,
      data,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!requesterId) {
      console.log('[teamUserLeft] Error: Unauthorized - no requesterId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    const normalizedGameId = this.normalizeId(data?.gameId);
    const normalizedUserId =
      this.normalizeId(data?.userId) || this.normalizeId(requesterId);

    if (!normalizedGameId) {
      console.log('[teamUserLeft] Error: gameId is required');
      return client.emit('errorMessage', { message: 'gameId is required' });
    }

    if (!normalizedUserId) {
      console.log('[teamUserLeft] Error: Invalid user');
      return client.emit('errorMessage', { message: 'Invalid user' });
    }

    const gameState = this.teamGames.get(normalizedGameId);
    if (!gameState) {
      return client.emit('errorMessage', { message: 'Team game not found' });
    }

    // Remove user from active room participants (best-effort)
    try {
      await this.contentService.removeUserFromRoomParticipants(
        normalizedGameId,
        normalizedUserId,
      );
    } catch (error) {
      // Ignore errors here; continue cleaning up local state
    }

    // Remove player from teams and tracking maps
    let leftTeamId: string | null = null;
    for (const [teamId, playerIds] of gameState.teams.entries()) {
      if (playerIds.includes(normalizedUserId)) {
        leftTeamId = teamId;
        const updatedPlayers = playerIds.filter((p) => p !== normalizedUserId);
        if (updatedPlayers.length === 0) {
          gameState.teams.delete(teamId);
          gameState.teamScores.delete(teamId);
        } else {
          gameState.teams.set(teamId, updatedPlayers);
        }
        break;
      }
    }

    gameState.players = gameState.players.filter((p) => p !== normalizedUserId);
    gameState.playerAnswers.delete(normalizedUserId);
    gameState.playerWrongAnswers.delete(normalizedUserId);
    gameState.eliminatedPlayers.delete(normalizedUserId);

    // Update persistence (best-effort)
    try {
      await this.teamGameService.removePlayerFromGame(
        gameState.gameId,
        normalizedUserId,
      );
    } catch (error) {
      // Non-blocking; continue notifying clients
    }

    // Emit left event to room, not globally - ensures only users in the room receive it
    this.server.to(gameState.roomId).emit('teamUserLeft', {
      gameId: gameState.gameId,
      roomId: gameState.roomId,
      userId: normalizedUserId,
      teamId: leftTeamId,
      remainingPlayers: gameState.players,
      remainingTeams: Array.from(gameState.teams.keys()),
    });

    // Re-broadcast updated team scores without the removed team if applicable
    const teamScoresObj: Record<string, number> = {};
    gameState.teamScores.forEach((score, teamId) => {
      teamScoresObj[teamId] = score;
    });

    // Emit to room, not globally - ensures only users in the room receive it
    this.server.to(gameState.roomId).emit('teamScoresUpdate', {
      gameId: gameState.gameId,
      roomId: gameState.roomId,
      teamScores: teamScoresObj,
    });

    // Check if game should end (no players or only one team left)
    const activeTeams = new Set<string>();
    gameState.players.forEach((playerId) => {
      for (const [teamId, playerIds] of gameState.teams.entries()) {
        if (playerIds.includes(playerId)) {
          activeTeams.add(teamId);
        }
      }
    });

    if (gameState.players.length === 0 || activeTeams.size <= 1) {
      setTimeout(() => {
        this.endTeamGame(gameState);
      }, 500);
    }
  }



  // -------------------------------------------------------------
  // CREATE AND START TEAM GAME
  // Client emits: teamCreateGame { topicType?, deckId?, gameMode?, member? }
  // Only host (inviter) can create game after room is created
  // Game will automatically start after creation
  // Validates that all teams have equal accepted players (2 teams or 3 teams)
  // -------------------------------------------------------------
  @SubscribeMessage('teamCreateGame')
  async createGame(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: {
      topicType?: 'random' | 'selected';
      deckId?: string;
      topicId?: string;
      gameMode?: 'Regular' | 'Knockout';
      member?: number;
    },
  ) {
    const userId = client.data.userId as string;
    console.log('[teamCreateGame] Event received:', {
      userId,
      body,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[teamCreateGame] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    const { topicType, deckId, topicId, gameMode, member } = body;

    // Validate topicType and deckId
    if (topicType === 'selected' && !deckId) {
      console.log('[teamCreateGame] Error: deckId is required when topicType is "selected"');
      return client.emit('errorMessage', {
        message: 'deckId is required when topicType is "selected"',
      });
    }

    try {
      // Check if user is in an active room
      const room = this.contentService.getRoomByUserId(userId);
      if (!room) {
        return client.emit('errorMessage', {
          message: 'You must be in a room to create a game. Accept an invite first.',
        });
      }

      // Prevent multiple concurrent games per room
      const existingGame = this.teamGames.get(room.roomId);
      if (existingGame && existingGame.isCompleted === false) {
        return client.emit('errorMessage', {
          message: 'A team game is already in progress for this room',
        });
      }

      // Check if user is the host (inviter) - only the user who sent the invites can start the game
      const normalizedUserId = this.normalizeId(userId);
      const inviterId = this.normalizeId(room.participants[0]);
      
      if (!inviterId || inviterId !== normalizedUserId) {
        return client.emit('errorMessage', {
          message: 'Only the user who sent the invites can start the game',
        });
      }

      // Validate team-based acceptance (all teams must have equal accepted players)
      // Exclude inviter (admin) from validation - they can only view, not play
      const teamValidation = await this.teamGameService.validateTeamBasedAcceptance(
        room.participants,
        inviterId,
      );

      if (!teamValidation.isValid) {
        return client.emit('errorMessage', {
          message: teamValidation.errorMessage || 'Team validation failed',
        });
      }

      // Create game in database
      const result = await this.teamGameService.createTeamGame(
        userId,
        topicType,
        deckId,
        room.roomId,
        room.participants,
        gameMode,
        member,
      );

      // Get game from database to start it
      const gameModel = this.contentService.getGameModel();
      const game = await gameModel.findOne({ gameId: result.gameId }).lean().exec();

      if (!game) {
        return client.emit('errorMessage', { message: 'Game not found after creation' });
      }

      // Generate questions - if deckId is provided, get topicId from deck and generate from all subtopics
      let questions: Question[] = [];
      let topic: any = null;
      let normalizedSubTopicId: string = '';
      let subTopicIndex: number = 1;
      let totalSubTopics: number = 1;

      // Determine topicId: use provided topicId, or get from deck if deckId is provided
      let resolvedTopicId: string | null = null;
      if (topicId) {
        resolvedTopicId = this.normalizeId(topicId);
      } else if (deckId) {
        // Get topicId from deck (first topic in deck)
        const normalizedDeckId = this.normalizeId(deckId);
        if (normalizedDeckId) {
          const deck = await this.deckModel.findById(normalizedDeckId).select('contentIds').lean().exec();
          if (deck && deck.contentIds && deck.contentIds.length > 0) {
            resolvedTopicId = this.normalizeId(deck.contentIds[0]);
          }
        }
      }

      if (deckId && resolvedTopicId) {
        // Generate questions from all subtopics of the topic
        const normalizedTopicId = resolvedTopicId;

        // Get the topic
        topic = await this.topicModel.findById(normalizedTopicId).lean().exec();
        if (!topic) {
          return client.emit('errorMessage', {
            message: 'Topic not found',
          });
        }

        // Get all subtopics for this topic
        const subTopicIds = (topic.subTopics || [])
          .map((id) => this.normalizeId(id))
          .filter((id): id is string => !!id);

        if (subTopicIds.length === 0) {
          return client.emit('errorMessage', {
            message: 'Topic has no subtopics',
          });
        }

        // Fetch all subtopics
        const subTopics = await this.subTopicModel
          .find({ _id: { $in: subTopicIds } })
          .select('title description')
          .lean()
          .exec();

        if (subTopics.length === 0) {
          return client.emit('errorMessage', {
            message: 'No subtopics found for this topic',
          });
        }

        // Combine all subtopic titles and descriptions
        const combinedTitle = topic.title || 'Combined Topic';
        const combinedDescription = subTopics
          .map((st) => `${st.title}: ${st.description || ''}`)
          .join('\n\n');

        // Generate questions from combined subtopics
        const aiService = this.contentService.getAiService();
        questions = await aiService.generateMCQQuestions(
          combinedTitle,
          combinedDescription,
          game.difficulty || 'medium',
        );

        // Use first subtopic ID for game state (for compatibility)
        normalizedSubTopicId = subTopicIds[0];
        subTopicIndex = 1;
        totalSubTopics = subTopicIds.length;

        // Update game's subTopicId in database to first subtopic of the topic
        await gameModel.updateOne(
          { gameId: result.gameId },
          {
            $set: {
              subTopicId: normalizedSubTopicId,
            },
          },
        );
      } else {
        // Use existing logic - generate questions for single subtopic
        const { subTopic, topic: fetchedTopic } = await this.contentService.getSubTopicAndTopic(
          game.subTopicId,
        );

        topic = fetchedTopic;
        const aiService = this.contentService.getAiService();
        questions = await aiService.generateMCQQuestions(
          subTopic.title,
          subTopic.description,
          game.difficulty || 'medium',
        );

        // Calculate topicId, subTopicIndex and totalSubTopics
        const topicIdFromSubTopic = this.normalizeId(topic._id) as string;
        const orderedSubTopicIds = (topic.subTopics ?? [])
          .map((id) => this.normalizeId(id))
          .filter((id): id is string => !!id);
        normalizedSubTopicId = this.normalizeId(game.subTopicId) as string;
        subTopicIndex =
          orderedSubTopicIds.findIndex((id) => id === normalizedSubTopicId) + 1;
        totalSubTopics = orderedSubTopicIds.length;
      }

      if (!Array.isArray(questions) || questions.length === 0) {
        return client.emit('errorMessage', {
          message: 'No questions available for this topic',
        });
      }

      // Calculate topicId and topicName for response
      const topicIdForResponse = this.normalizeId(topic._id) as string;
      const topicName = topic.title || '';

      // Update game with questions and mark as started
      await gameModel.updateOne(
        { gameId: result.gameId },
        {
          $set: {
            questions,
            gameStarted: true,
            startTime: new Date(),
            currentQuestion: 0,
          },
        },
      );

      // Create team game state (reuse teamValidation from above)
      // inviterId is already defined above
      
      const teamGameState: TeamGameState = {
        gameId: result.gameId,
        roomId: room.roomId,
        deckId: result.deckId,
        players: game.players,
        teams: teamValidation.teams,
        subTopicId: normalizedSubTopicId || game.subTopicId,
        questions,
        currentIndex: 0,
        playerAnswers: new Map(),
        teamScores: new Map(),
        playerWrongAnswers: new Map(),
        eliminatedPlayers: new Set(),
        gameMode: (game.metadata as any)?.gameMode as 'Regular' | 'Knockout' | undefined,
        inviterId: inviterId,
        startedAt: new Date(),
        questionStartTimes: new Map(),
        isCompleted: false,
      };

      // Initialize scores and answers for all players
      game.players.forEach((playerId) => {
        teamGameState.playerAnswers.set(playerId, []);
        teamGameState.playerWrongAnswers.set(playerId, 0);
      });

      // Initialize team scores
      teamValidation.teams.forEach((_, teamId) => {
        teamGameState.teamScores.set(teamId, 0);
      });

      this.teamGames.set(room.roomId, teamGameState);

      // Get player info (name, profileImage, isHost) for all participants
      const playerInfo: Record<string, { name: string; profileImage: string | null; isHost: boolean }> = {};
      const hostId = this.normalizeId(room.participants[0]);
      
      await Promise.all(
        room.participants.map(async (participantId) => {
          const normalizedId = this.normalizeId(participantId);
          if (!normalizedId) return;
          try {
            const player = await this.usersService.findById(normalizedId);
            const userName = (player as any)?.name || (player as any)?.username || '';
            const userProfileImage = (player as any)?.profileImage || null;
            const isHost = normalizedId === hostId;
            playerInfo[normalizedId] = {
              name: userName,
              profileImage: userProfileImage,
              isHost: isHost,
            };
          } catch (error) {
            // Default values if user not found
            const isHost = normalizedId === hostId;
            playerInfo[normalizedId] = {
              name: '',
              profileImage: null,
              isHost: isHost,
            };
          }
        }),
      );

      // Get team points and team names for each team
      const teampoint: Record<string, number> = {};
      const teamsInfo: Record<string, { teamName: string }> = {};
      const totalmember: Record<string, number> = {}; // Count of accepted players per team
      const teamIds = Array.from(teamValidation.teams.keys());
      if (teamIds.length > 0) {
        const teams = await this.teamModel
          .find({ _id: { $in: teamIds } })
          .select('_id points teamName')
          .lean()
          .exec();
        teams.forEach((team: any) => {
          const teamId = this.normalizeId(team._id);
          if (teamId) {
            teampoint[teamId] = typeof team.points === 'number' && Number.isFinite(team.points) ? team.points : 0;
            teamsInfo[teamId] = {
              teamName: (team as any)?.teamName || '',
            };
            // Get count of accepted players for this team
            const playerIds = teamValidation.teams.get(teamId) || [];
            totalmember[teamId] = playerIds.length;
          }
        });
      }

      // Get deck name
      let deckName: string | null = null;
      if (result.deckId) {
        try {
          const deck = await this.deckModel.findById(result.deckId).select('name').lean().exec();
          if (deck) {
            deckName = (deck as any)?.name || null;
          }
        } catch (error) {
          console.warn('Failed to fetch deck name:', error);
        }
      }

      // Notify all players that game is created and started
      // Emit to room, not globally - ensures only users in the room receive it
      // When generating from all subtopics (deckId + topicId), exclude subTopicId, subTopicIndex, totalSubTopics
      const isAllSubTopicsMode = deckId && resolvedTopicId;
      const teamGameCreatedPayload: any = {
        success: true,
        gameId: result.gameId,
        roomId: room.roomId,
        deckId: result.deckId,
        deckName: deckName,
        topicId: topicIdForResponse,
        topicName: topicName,
        totalQuestions: questions.length,
        timePerQuestion: QUESTION_TIME_SECONDS,
        playerInfo: playerInfo,
        teams: teamsInfo,
        teampoint: teampoint,
        totalmember: totalmember, // Count of accepted players per team
        questions: questions,
        // mode: 'BRAWL', // Team games are always BRAWL mode
        topicType: topicType || 'random',
        players: room.participants,
        gameMode: gameMode || undefined,
        member: member || undefined,
      };

      // Only include subTopicId, subTopicIndex, totalSubTopics when NOT generating from all subtopics
      if (!isAllSubTopicsMode) {
        teamGameCreatedPayload.subTopicId = normalizedSubTopicId;
        teamGameCreatedPayload.subTopicIndex = subTopicIndex;
        teamGameCreatedPayload.totalSubTopics = totalSubTopics;
      }
      this.server.to(room.roomId).emit('teamGameCreated', teamGameCreatedPayload);

      // Send first question to all players
      this.sendNextTeamQuestion(teamGameState);
    } catch (error) {
      console.error('[teamCreateGame] Error occurred:', {
        userId,
        error: error.message,
        stack: error.stack,
        body,
      });
      client.emit('errorMessage', {
        message: error?.message || 'Failed to create and start game',
      });
    }
  }

  // -------------------------------------------------------------
  // SEND NEXT TEAM QUESTION
  // -------------------------------------------------------------
  private sendNextTeamQuestion(gameState: TeamGameState) {
    const { roomId, questions, currentIndex } = gameState;

    if (currentIndex >= questions.length) {
      return this.endTeamGame(gameState);
    }

    const q = questions[currentIndex];

    // Get list of eliminated players for Knockout mode
    const eliminatedPlayersList = gameState.gameMode === 'Knockout' 
      ? Array.from(gameState.eliminatedPlayers)
      : [];

    // Emit question event (same as regular game gateway for consistency)
    // Admin/inviter can view questions but cannot answer
    // Emit to room, not globally - ensures only users in the room receive it
    // this.server.to(roomId).emit('question', {
    //   index: currentIndex,
    //   total: questions.length,
    //   question: {
    //     text: q.question,
    //     options: q.options ?? [],
    //     id: q.id,
    //     hint: q.hint,
    //   },
    //   time: QUESTION_TIME_SECONDS,
    //   eliminatedPlayers: eliminatedPlayersList,
    //   gameMode: gameState.gameMode,
    //   inviterId: gameState.inviterId, // Include inviterId so client knows who can't answer
    // });

    const questionStartTime = new Date();
    gameState.questionStartAt = questionStartTime;
    gameState.questionStartTimes.set(currentIndex, questionStartTime);

    // Timer removed - no auto-submit
  }

  // -------------------------------------------------------------
  // ANSWER HANDLER FOR TEAM GAMES AND SINGLE PLAYER TEAM MEMBER GAMES
  // Client emits: teamSubmitAnswer { index, answer, gameId?, responstime? }
  // Same as submitanswer from game.gateway.ts - handles both team games and single-player games
  // -------------------------------------------------------------
  @SubscribeMessage('teamSubmitAnswer')
  async teamAnswerQuestion(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { index: number; answer: string | null; gameId?: string; responstime?: number },
  ) {
    const userId = client.data.userId;
    console.log('[teamSubmitAnswer] Event received:', {
      userId,
      body,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[teamSubmitAnswer] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    // Check if user is online
    const isOnline = await this.checkUserIsOnline(userId);
    console.log('[teamSubmitAnswer] User online status:', { userId, isOnline });
    if (!isOnline) {
      console.log('[teamSubmitAnswer] Error: User is not online');
      return client.emit('errorMessage', {
        message: 'You must be online to submit answers. Please set your status to online.',
      });
    }

    const { answer, index, gameId, responstime } = body;
    console.log('[teamSubmitAnswer] Processing answer:', {
      userId,
      index,
      hasAnswer: !!answer,
      gameId,
      responstime,
    });

    // Check if it's a team game
    if (gameId) {
      console.log('[teamSubmitAnswer] Checking for team game:', { gameId });
      const room = this.contentService.getRoomByRoomId(gameId);
      if (room) {
        const teamGameState = this.teamGames.get(room.roomId);
        if (teamGameState) {
          console.log('[teamSubmitAnswer] Handling team game answer:', {
            userId,
            gameId,
            roomId: room.roomId,
          });
          return this.handleTeamAnswer(
            client,
            teamGameState,
            userId,
            index,
            answer,
            responstime,
          );
        }
      }
    }

    // Single player game
    console.log('[teamSubmitAnswer] Handling single-player answer:', { userId });
    const gameState = this.activeGames.get(userId);
    if (!gameState) {
      console.log('[teamSubmitAnswer] Error: No active game found:', { userId });
      return client.emit('errorMessage', { message: 'No active game' });
    }

    const currentIndex = gameState.currentIndex;

    if (Number(index) !== Number(currentIndex)) {
      console.log('[teamSubmitAnswer] Error: Invalid question index:', {
        userId,
        providedIndex: index,
        currentIndex,
      });
      return client.emit('errorMessage', {
        message: 'Invalid question index',
      });
    }

    const currentQ = gameState.questions[currentIndex];

    // Handle null answer - treat as incorrect
    const isCorrect = answer !== null &&
      currentQ.correctAnswer.trim().toLowerCase() ===
      answer.trim().toLowerCase();
    gameState.isCorrect = isCorrect;
    console.log('[teamSubmitAnswer] Answer evaluated:', {
      userId,
      index: currentIndex,
      isCorrect,
      userAnswer: answer,
      correctAnswer: currentQ.correctAnswer,
    });

    gameState.answers.push({
      index: currentIndex,
      question: currentQ.question,
      userAnswer: answer,
      correctAnswer: currentQ.correctAnswer,
      isCorrect,
      timestamp: new Date(),
    });

    // Update player progress immediately
    await this.contentService.updateProgressAfterQuestion(
      userId,
      isCorrect,
    );
    
    if (isCorrect) {
      gameState.score++;
      console.log('[teamSubmitAnswer] Correct answer, updating score:', {
        userId,
        newScore: gameState.score,
        currentIndex,
      });

      client.emit('answerResult', {
        correct: true,
        score: gameState.score,
        lives: gameState.lives,
        questionIndex: currentIndex,
      });

      gameState.currentIndex++;
      if (gameState.currentIndex >= gameState.questions.length) {
        console.log('[teamSubmitAnswer] All questions completed, ending game:', {
          userId,
          finalScore: gameState.score,
        });
        return this.endGame(gameState);
      }
      this.sendNextQuestion(gameState);
    } else {
      // WRONG ANSWER
      console.log('[teamSubmitAnswer] Wrong answer, handling:', {
        userId,
        currentIndex,
      });
      await this.handleWrongAnswer(gameState, answer, client);
    }
  }

  // -------------------------------------------------------------
  // HANDLE TEAM ANSWER
  // -------------------------------------------------------------
  private async handleTeamAnswer(
    client: Socket,
    gameState: TeamGameState,
    userId: string,
    index: number,
    answer: string | null,
    responstime?: number,
  ) {
    const normalizedUserId = this.normalizeId(userId);
    if (!normalizedUserId) {
      return client.emit('errorMessage', { message: 'Invalid user' });
    }

    // Block inviter (admin) from answering - they can only view
    const normalizedInviterId = this.normalizeId(gameState.inviterId);
    if (normalizedUserId === normalizedInviterId) {
      return client.emit('errorMessage', {
        message: 'Admin can only view questions, not answer them',
      });
    }

    if (!gameState.players.includes(normalizedUserId)) {
      return client.emit('errorMessage', {
        message: 'You are not a player in this game',
      });
    }

    // Check if player is eliminated (Knockout mode)
    if (gameState.eliminatedPlayers.has(normalizedUserId)) {
      return client.emit('errorMessage', {
        message: 'You have been eliminated and cannot answer questions',
      });
    }

    const currentIndex = gameState.currentIndex;

    if (Number(index) !== Number(currentIndex)) {
      return client.emit('errorMessage', {
        message: 'Invalid question index',
      });
    }

    // Check if user already answered this question
    const userAnswers = gameState.playerAnswers.get(normalizedUserId) || [];
    const alreadyAnswered = userAnswers.some((a) => a.index === currentIndex);
    if (alreadyAnswered) {
      return client.emit('errorMessage', {
        message: 'You have already answered this question',
      });
    }

    const currentQ = gameState.questions[currentIndex];
    // Handle null answer - treat as incorrect
    const isCorrect = answer !== null &&
      currentQ.correctAnswer.trim().toLowerCase() ===
      answer.trim().toLowerCase();

    // Record answer
    const answerRecord: AnswerRecord = {
      index: currentIndex,
      question: currentQ.question,
      userAnswer: answer,
      correctAnswer: currentQ.correctAnswer,
      isCorrect,
      timestamp: new Date(),
      responstime: responstime, // Store response time from client
    };

    userAnswers.push(answerRecord);
    gameState.playerAnswers.set(normalizedUserId, userAnswers);

    // Update team score if correct
    if (isCorrect) {
      // Find which team this player belongs to
      for (const [teamId, playerIds] of gameState.teams.entries()) {
        if (playerIds.includes(normalizedUserId)) {
          const currentTeamScore = gameState.teamScores.get(teamId) || 0;
          gameState.teamScores.set(teamId, currentTeamScore + 1);
          break;
        }
      }
    } else {
      // Track wrong answers for Knockout mode
      if (gameState.gameMode === 'Knockout') {
        const currentWrongAnswers = gameState.playerWrongAnswers.get(normalizedUserId) || 0;
        const newWrongAnswers = currentWrongAnswers + 1;
        gameState.playerWrongAnswers.set(normalizedUserId, newWrongAnswers);

        // Check if player should be eliminated (3 wrong answers)
        if (newWrongAnswers >= 3) {
          gameState.eliminatedPlayers.add(normalizedUserId);
          
          // Get all eliminated players list
          const allEliminatedPlayers = Array.from(gameState.eliminatedPlayers);
          
          // Find which team the eliminated player belongs to
          let eliminatedPlayerTeamId: string | null = null;
          for (const [teamId, playerIds] of gameState.teams.entries()) {
            if (playerIds.includes(normalizedUserId)) {
              eliminatedPlayerTeamId = teamId;
              break;
            }
          }
          
          // Notify only the eliminated player's team members about elimination
          // Exclude inviter (admin) from receiving the event
          const normalizedInviterId = this.normalizeId(gameState.inviterId);
          if (eliminatedPlayerTeamId) {
            const teamMembers = gameState.teams.get(eliminatedPlayerTeamId) || [];
            teamMembers.forEach((teamMemberId) => {
              const normalizedTeamMemberId = this.normalizeId(teamMemberId);
              // Only send to team members (not the inviter/host)
              if (normalizedTeamMemberId && normalizedTeamMemberId !== normalizedInviterId) {
                const teamMemberSocket = this.userSockets.get(normalizedTeamMemberId);
                if (teamMemberSocket) {
                  teamMemberSocket.emit('teamPlayerEliminated', {
                    eliminatedUserId: normalizedUserId,
                    gameId: gameState.gameId,
                    roomId: gameState.roomId,
                    wrongAnswers: newWrongAnswers,
                    allEliminatedPlayers: allEliminatedPlayers,
                    activePlayers: gameState.players.filter(
                      (p) => !gameState.eliminatedPlayers.has(p)
                    ),
                  });
                }
              }
            });
          }

          // Notify the eliminated player specifically
          client.emit('youAreEliminated', {
            message: 'You have been eliminated after 3 wrong answers',
            wrongAnswers: newWrongAnswers,
            eliminatedPlayers: allEliminatedPlayers,
          });

          // Check if game should end (only one team remaining)
          const activeTeams = new Set<string>();
          gameState.players.forEach((playerId) => {
            if (!gameState.eliminatedPlayers.has(playerId)) {
              for (const [teamId, playerIds] of gameState.teams.entries()) {
                if (playerIds.includes(playerId)) {
                  activeTeams.add(teamId);
                }
              }
            }
          });

          if (activeTeams.size <= 1) {
            // End game early
            setTimeout(() => {
              this.endTeamGame(gameState);
            }, 2000);
            return;
          }
        }
      }
    }

    // Update progress
    await this.contentService.updateProgressAfterQuestion(
      normalizedUserId,
      isCorrect,
    );

    // Get team ID for this player
    let playerTeamId: string | null = null;
    for (const [teamId, playerIds] of gameState.teams.entries()) {
      if (playerIds.includes(normalizedUserId)) {
        playerTeamId = teamId;
        break;
      }
    }

    // Send answer result to the player
    client.emit('teamAnswerResult', {
      correct: isCorrect,
      teamScore: playerTeamId ? (gameState.teamScores.get(playerTeamId) || 0) : 0,
      questionIndex: currentIndex,
      correctAnswer: currentQ.correctAnswer,
      wrongAnswers: gameState.playerWrongAnswers.get(normalizedUserId) || 0,
      isEliminated: gameState.eliminatedPlayers.has(normalizedUserId),
      responstime: responstime, // Include response time in response
    });

    // Broadcast team scores update
    const teamScoresObj: Record<string, number> = {};
    gameState.teamScores.forEach((score, teamId) => {
      teamScoresObj[teamId] = score;
    });

    // Emit to room, not globally - ensures only users in the room receive it
    this.server.to(gameState.roomId).emit('teamScoresUpdate', {
      gameId: gameState.gameId,
      roomId: gameState.roomId,
      teamScores: teamScoresObj,
    });

    // Check if all active (non-eliminated) players have answered
    // Exclude inviter (admin) from the check - they can only view, not answer
    const activePlayers = gameState.players.filter(
      (p) => !gameState.eliminatedPlayers.has(p) && this.normalizeId(p) !== normalizedInviterId
    );
    const allAnswered = activePlayers.every((playerId) => {
      const answers = gameState.playerAnswers.get(playerId) || [];
      return answers.some((a) => a.index === currentIndex);
    });

    // Only broadcast all user answers when ALL participants have answered
    if (allAnswered) {
      // Collect all answers for current question from all players
      const allUserAnswers: Array<{
        userId: string;
        userAnswer: string | null;
        isCorrect: boolean;
        teamScore: number;
        responstime?: number;
      }> = [];
      for (const playerId of gameState.players) {
        const playerAnswers = gameState.playerAnswers.get(playerId) || [];
        const currentQuestionAnswer = playerAnswers.find((a) => a.index === currentIndex);
        if (currentQuestionAnswer) {
          // Get team ID for this player
          let playerTeamId: string | null = null;
          for (const [teamId, playerIds] of gameState.teams.entries()) {
            if (playerIds.includes(playerId)) {
              playerTeamId = teamId;
              break;
            }
          }
          
          allUserAnswers.push({
            userId: playerId,
            userAnswer: currentQuestionAnswer.userAnswer,
            isCorrect: currentQuestionAnswer.isCorrect,
            teamScore: playerTeamId ? (gameState.teamScores.get(playerTeamId) || 0) : 0,
            responstime: currentQuestionAnswer.responstime, // Include response time
          });
        }
      }

      // Broadcast all user answers to all participants in the room
      this.server.to(gameState.roomId).emit('alluseranswerresult', {
        gameId: gameState.gameId,
        roomId: gameState.roomId,
        questionIndex: currentIndex,
        correctAnswer: currentQ.correctAnswer,
        allAnswers: allUserAnswers,
      });

      // Wait a bit before sending next question
      setTimeout(() => {
        gameState.currentIndex++;
        if (gameState.currentIndex >= gameState.questions.length) {
          // All questions completed, end game
          this.endTeamGame(gameState);
        } else {
          this.sendNextTeamQuestion(gameState);
        }
      }, 1000);
    }
  }

  // -------------------------------------------------------------
  // HANDLE TEAM QUESTION TIMEOUT
  // -------------------------------------------------------------
  private async handleTeamQuestionTimeout(gameState: TeamGameState) {
    const { currentIndex, questions } = gameState;
    const currentQ = questions[currentIndex];

    // Mark unanswered active (non-eliminated) players as wrong
    // Exclude inviter (admin) from timeout handling - they can only view, not answer
    const normalizedInviterId = this.normalizeId(gameState.inviterId);
    const activePlayers = gameState.players.filter(
      (p) => !gameState.eliminatedPlayers.has(p) && this.normalizeId(p) !== normalizedInviterId
    );

    for (const playerId of activePlayers) {
      const answers = gameState.playerAnswers.get(playerId) || [];
      const alreadyAnswered = answers.some((a) => a.index === currentIndex);

      if (!alreadyAnswered) {
        const answerRecord: AnswerRecord = {
          index: currentIndex,
          question: currentQ.question,
          userAnswer: null,
          correctAnswer: currentQ.correctAnswer,
          isCorrect: false,
          timestamp: new Date(),
        };

        answers.push(answerRecord);
        gameState.playerAnswers.set(playerId, answers);

        // Track wrong answers for Knockout mode
        if (gameState.gameMode === 'Knockout') {
          const currentWrongAnswers = gameState.playerWrongAnswers.get(playerId) || 0;
          const newWrongAnswers = currentWrongAnswers + 1;
          gameState.playerWrongAnswers.set(playerId, newWrongAnswers);

          // Check if player should be eliminated (3 wrong answers)
          if (newWrongAnswers >= 3) {
            gameState.eliminatedPlayers.add(playerId);
            
            // Get all eliminated players list
            const allEliminatedPlayers = Array.from(gameState.eliminatedPlayers);
            
            // Find which team the eliminated player belongs to
            let eliminatedPlayerTeamId: string | null = null;
            for (const [teamId, playerIds] of gameState.teams.entries()) {
              if (playerIds.includes(playerId)) {
                eliminatedPlayerTeamId = teamId;
                break;
              }
            }
            
            // Notify only the eliminated player's team members about elimination
            // Exclude inviter (admin) from receiving the event
            const normalizedInviterId = this.normalizeId(gameState.inviterId);
            if (eliminatedPlayerTeamId) {
              const teamMembers = gameState.teams.get(eliminatedPlayerTeamId) || [];
              teamMembers.forEach((teamMemberId) => {
                const normalizedTeamMemberId = this.normalizeId(teamMemberId);
                // Only send to team members (not the inviter/host)
                if (normalizedTeamMemberId && normalizedTeamMemberId !== normalizedInviterId) {
                  const teamMemberSocket = this.userSockets.get(normalizedTeamMemberId);
                  if (teamMemberSocket) {
                    teamMemberSocket.emit('teamPlayerEliminated', {
                      eliminatedUserId: playerId,
                      gameId: gameState.gameId,
                      roomId: gameState.roomId,
                      wrongAnswers: newWrongAnswers,
                      allEliminatedPlayers: allEliminatedPlayers,
                      activePlayers: gameState.players.filter(
                        (p) => !gameState.eliminatedPlayers.has(p)
                      ),
                    });
                  }
                }
              });
            }

            // Notify the eliminated player specifically
            const playerSocket = this.userSockets.get(playerId);
            if (playerSocket) {
              playerSocket.emit('youAreEliminated', {
                message: 'You have been eliminated after 3 wrong answers',
                wrongAnswers: newWrongAnswers,
                eliminatedPlayers: allEliminatedPlayers,
              });
            }
          }
        }

        // Send timeout result to player
        const playerSocket = this.userSockets.get(playerId);
        if (playerSocket) {
          // Get team ID for this player
          let playerTeamId: string | null = null;
          for (const [teamId, playerIds] of gameState.teams.entries()) {
            if (playerIds.includes(playerId)) {
              playerTeamId = teamId;
              break;
            }
          }

          playerSocket.emit('teamAnswerResult', {
            correct: false,
            teamScore: playerTeamId ? (gameState.teamScores.get(playerTeamId) || 0) : 0,
            questionIndex: currentIndex,
            correctAnswer: currentQ.correctAnswer,
            timeout: true,
            wrongAnswers: gameState.playerWrongAnswers.get(playerId) || 0,
            isEliminated: gameState.eliminatedPlayers.has(playerId),
            responstime: undefined, // No response time for timeout
          });
        }
      }
    }

    // Collect all answers for current question from all players (including timeout answers)
    const allUserAnswers: Array<{
      userId: string;
      userAnswer: string | null;
      isCorrect: boolean;
      teamScore: number;
      responstime?: number;
    }> = [];
    for (const playerId of gameState.players) {
      const playerAnswers = gameState.playerAnswers.get(playerId) || [];
      const currentQuestionAnswer = playerAnswers.find((a) => a.index === currentIndex);
      if (currentQuestionAnswer) {
        // Get team ID for this player
        let playerTeamId: string | null = null;
        for (const [teamId, playerIds] of gameState.teams.entries()) {
          if (playerIds.includes(playerId)) {
            playerTeamId = teamId;
            break;
          }
        }
        
        allUserAnswers.push({
          userId: playerId,
          userAnswer: currentQuestionAnswer.userAnswer,
          isCorrect: currentQuestionAnswer.isCorrect,
          teamScore: playerTeamId ? (gameState.teamScores.get(playerTeamId) || 0) : 0,
          responstime: currentQuestionAnswer.responstime, // Include response time
        });
      }
    }

    // Broadcast all user answers to all participants in the room
    this.server.to(gameState.roomId).emit('alluseranswerresult', {
      gameId: gameState.gameId,
      roomId: gameState.roomId,
      questionIndex: currentIndex,
      correctAnswer: currentQ.correctAnswer,
      allAnswers: allUserAnswers,
    });

    // Check if game should end (only one team remaining)
    const activeTeams = new Set<string>();
    gameState.players.forEach((playerId) => {
      if (!gameState.eliminatedPlayers.has(playerId)) {
        for (const [teamId, playerIds] of gameState.teams.entries()) {
          if (playerIds.includes(playerId)) {
            activeTeams.add(teamId);
          }
        }
      }
    });

    if (activeTeams.size <= 1) {
      // End game early
      setTimeout(() => {
        this.endTeamGame(gameState);
      }, 2000);
      return;
    }

    // Move to next question
    setTimeout(() => {
      gameState.currentIndex++;
      if (gameState.currentIndex >= gameState.questions.length) {
        // All questions completed, end game
        this.endTeamGame(gameState);
      } else {
        this.sendNextTeamQuestion(gameState);
      }
    }, 1000);
  }

  // -------------------------------------------------------------
  // SEND NEXT QUESTION (for single player team member games)
  // -------------------------------------------------------------
  private sendNextQuestion(gameState: GameState) {
    const { socket, questions, currentIndex } = gameState;

    if (currentIndex >= questions.length) {
      return this.endGame(gameState);
    }

    const q = questions[currentIndex];

    // socket.emit('question', {
    //   index: currentIndex,
    //   total: questions.length,
    //   question: {
    //     text: q.question,
    //     options: q.options ?? [],
    //     id: q.id,
    //     hint: q.hint,
    //   },
    //   lives: gameState.lives,
    //   time: QUESTION_TIME_SECONDS,
    // });

    gameState.questionStartAt = new Date();

    // Timer removed - no auto-submit
  }

  // -------------------------------------------------------------
  // WRONG ANSWER HANDLER (for single player team member games)
  // -------------------------------------------------------------
  private async handleWrongAnswer(
    gameState: GameState,
    userAnswer: string | null,
    client?: Socket,
  ) {
    const { socket, questions, currentIndex, userId } = gameState;
    const currentQ = questions[currentIndex];

    // Prevent double push
    const exists = gameState.answers.some((a) => a.index === currentIndex);
    if (!exists) {
      gameState.answers.push({
        index: currentIndex,
        question: currentQ.question,
        userAnswer:userAnswer ? userAnswer : null,
        correctAnswer: currentQ.correctAnswer,
        isCorrect: false,
        timestamp: new Date(),
      });
    }

    // Decrement lives in User model (1 life deducted)
    const updatedUser = await this.usersService.decrementLife(userId, 1);

    if (!updatedUser) {
      console.warn('User not found while decrementing life');
      return;
    }

    // Also decrement lives in GameProgress (1 life deducted)
    await this.contentService.decrementLives(userId, 1);

    // Prefer provided client (if any), otherwise fall back to game state's socket
    const targetSocket = client ?? socket;

    gameState.lives = updatedUser.lives;
    targetSocket.emit('answerResult', {
      correct: false,
      livesLeft: gameState.lives,
      correctAnswer: currentQ.correctAnswer,
      questionIndex: currentIndex,
      userAnswer:userAnswer ? userAnswer : null
    });

    if (gameState.lives <= 0) {
      return this.endGame(gameState);
    }

    gameState.currentIndex++;
    setTimeout(() => this.sendNextQuestion(gameState), 700);
  }

  // -------------------------------------------------------------
  // END GAME (for single player team member games)
  // -------------------------------------------------------------
  private async endGame(gameState: GameState) {
    // Timer removed - no cleanup needed

    const { socket, score, questions, answers, startedAt } = gameState;

    // Calculate accuracy: (correct answers / total questions) * 100
    const totalQuestions = questions.length;
    const correctAnswers = answers.filter((answer) => answer.isCorrect).length;
    const accuracy =
      totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;
    const accuracyRounded = Math.round(accuracy * 100) / 100;

    // Persist flashcard accuracy to deck (if this game was tied to a deck)
    // Always try to find deck from subtopicId -> topicId -> deck
    try {
      const gameDoc = await this.contentService
        .getGameModel()
        .findOne({ gameId: gameState.gameId })
        .select('selectedDeckId subTopicId')
        .lean();
      let selectedDeckId = this.normalizeId(gameDoc?.selectedDeckId);
      
      // Always try to find deck by topicId from subtopicId if we have subtopicId
      // This ensures we always get the deck even if selectedDeckId is not set
      if (gameState.subTopicId || gameDoc?.subTopicId) {
        try {
          const subtopicId = gameState.subTopicId || gameDoc?.subTopicId;
          if (subtopicId) {
            const { topic } = await this.contentService.getSubTopicAndTopic(
              subtopicId,
            );
            const topicId = this.normalizeId(topic._id);
            if (topicId) {
              // Find deck that contains this topic
              const deckIdFromTopic = await this.teamGameService.findDeckIdByTopicId(topicId);
              if (deckIdFromTopic) {
                selectedDeckId = deckIdFromTopic;
              }
            }
          }
        } catch (error) {
          // Non-blocking: log but continue
          console.error('Failed to find deck by topicId from subtopicId', error);
        }
      }
      
      // Record flashcard accuracy to deck
      if (selectedDeckId) {
        await this.teamGameService.recordDeckAccuracy(
          selectedDeckId,
          gameState.userId,
          accuracyRounded,
          'flashcard',
        );
      }

      // Record flashcard accuracy to subtopic and update topic
      if (gameState.subTopicId || gameDoc?.subTopicId) {
        const subtopicId = gameState.subTopicId || gameDoc?.subTopicId;
        if (subtopicId) {
          await this.teamGameService.recordSubTopicAccuracy(
            subtopicId,
            gameState.userId,
            accuracyRounded,
            'flashcard',
          );
        }
      }
    } catch (error) {
      // non-blocking
      console.error('Failed to record deck flashcard accuracy', error);
    }

    await this.contentService.completeGame(gameState.gameId, {
      currentQuestion: gameState.currentIndex,
      scores: { [gameState.userId]: score },
      playerAnswers: answers.map((answer) => ({
        userId: gameState.userId,
        questionIndex: answer.index,
        answer: answer.userAnswer ?? '',
        isCorrect: answer.isCorrect,
        timestamp: answer.timestamp ?? new Date(),
      })),
      lastQuestionTimestamp: new Date(),
      accuracy: { [gameState.userId]: accuracyRounded },
    });

    // Update team-member accuracy aggregates (flashcard/battle/game)
    try {
      await this.teamGameService.refreshMemberAccuracies(gameState.userId);
    } catch (error) {
      console.error('Failed to refresh member accuracies', error);
    }

    // Increment totalGamesPlayed when game is completed
    await this.contentService.incrementTotalGamesPlayed(gameState.userId);

    // Update daily streak (Type 1: 7-day icons, Type 2: current streak)
    // await this.contentService.updateDailyStreak(gameState.userId);

    // Award points based on score (1 point per correct answer)
    const pointsToAward = score;
    if (pointsToAward > 0) {
      await this.contentService.awardPointsAndCoins(
        gameState.userId,
        pointsToAward,
        0, // No coins for single player
      );
    }

    if (gameState.subTopicId) {
      try {
        await this.contentService.updateSubTopicUserAccuracy(
          gameState.subTopicId,
          gameState.userId,
          accuracyRounded,
        );
        await this.contentService.markSubTopicCompletedForUser(
          gameState.userId,
          gameState.subTopicId,
        );
      } catch (error) {
        // best-effort update; log for visibility without interrupting game end
        console.error('Failed to update subtopic accuracy', error);
      }
    }

    // Check if user has 0 lives and set up refill timer (5 minutes later)
    // Refill amount: 15 lives for "individual"/"Individual", 50 lives for "member"
    if (gameState.lives <= 0) {
      try {
        const user = await this.usersService.findById(gameState.userId);
        if (user && user.lives <= 0) {
          // Set nextLivesRefillAt to 5 minutes from now if not already set
          const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
          if (!user.nextLivesRefillAt || user.nextLivesRefillAt.getTime() > fiveMinutesFromNow.getTime()) {
            await this.userModel.findByIdAndUpdate(
              gameState.userId,
              {
                $set: {
                  nextLivesRefillAt: fiveMinutesFromNow,
                },
              },
            ).exec();
          }
        }
      } catch (error) {
        // Non-blocking: log error but don't interrupt game end
        console.error('Failed to set lives refill timer', error);
      }
    }

    socket.emit('gameOver', {
      gameId: gameState.gameId,
      score,
      totalQuestions: questions.length,
      answers,
      livesLeft: gameState.lives,
      startedAt,
      endedAt: new Date(),
      isCompleted: true,
      accuracy: accuracyRounded,
    });

    this.activeGames.delete(gameState.userId);
  }

  // -------------------------------------------------------------
  // END TEAM GAME
  // -------------------------------------------------------------
  private async endTeamGame(gameState: TeamGameState) {
    // Timer removed - no cleanup needed

    const { gameId, players, questions, playerAnswers, teamScores, teams } = gameState;

    // Calculate team correct answers and accuracy
    const teamCorrectCounts: Map<string, number> = new Map();
    const teamAccuracies: Map<string, number> = new Map();

    teams.forEach((playerIds, teamId) => {
      let teamCorrectCount = 0;
      let teamTotalAnswers = 0;

      playerIds.forEach((playerId) => {
        const answers = playerAnswers.get(playerId) || [];
        const correctCount = answers.filter((a) => a.isCorrect).length;
        teamCorrectCount += correctCount;
        teamTotalAnswers += answers.length;
      });

      teamCorrectCounts.set(teamId, teamCorrectCount);
      
      // Calculate accuracy: (correct answers / total questions) * 100
      const totalQuestions = questions.length;
      const accuracy = totalQuestions > 0 ? (teamCorrectCount / totalQuestions) * 100 : 0;
      const accuracyRounded = Math.round(accuracy * 100) / 100;
      teamAccuracies.set(teamId, accuracyRounded);
    });

    // Calculate individual player accuracy
    const playerAccuracies: Map<string, number> = new Map();
    const totalQuestions = questions.length;

    players.forEach((playerId) => {
      const answers = playerAnswers.get(playerId) || [];
      const correctCount = answers.filter((a) => a.isCorrect).length;
      const accuracy = totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0;
      const accuracyRounded = Math.round(accuracy * 100) / 100;
      playerAccuracies.set(playerId, accuracyRounded);
    });

    // Persist per-user battle accuracy on the associated deck (if available)
    let deckIdForGame: string | undefined = gameState.deckId;
    if (!deckIdForGame) {
      try {
        const gameDoc = await this.contentService
          .getGameModel()
          .findOne({ gameId })
          .select('selectedDeckId')
          .lean();
        deckIdForGame = this.normalizeId(gameDoc?.selectedDeckId) || undefined;
      } catch (error) {
        console.error('Failed to fetch deck for team game accuracy', error);
      }
    }

    if (deckIdForGame) {
      await Promise.all(
        Array.from(playerAccuracies.entries()).map(
          ([playerId, accuracy]) =>
            this.teamGameService.recordDeckAccuracy(
              deckIdForGame,
              playerId,
              accuracy,
              'battle',
            ),
        ),
      );
    }

    // Record battle accuracy to subtopic and update topic for each player
    if (gameState.subTopicId) {
      try {
        await Promise.all(
          Array.from(playerAccuracies.entries()).map(
            ([playerId, accuracy]) =>
              this.teamGameService.recordSubTopicAccuracy(
                gameState.subTopicId,
                playerId,
                accuracy,
                'battle',
              ),
          ),
        );
      } catch (error) {
        // Non-blocking: log error but don't interrupt game completion
        console.error('Failed to record subtopic battle accuracy', error);
      }
    }

    // Calculate average response time for each player
    const playerAverageResponseTimes: Map<string, number> = new Map();
    players.forEach((playerId) => {
      const answers = playerAnswers.get(playerId) || [];
      // Filter answers that have response time (exclude null/undefined)
      const answersWithResponseTime = answers.filter(
        (a) => a.responstime !== undefined && a.responstime !== null
      );
      
      if (answersWithResponseTime.length > 0) {
        // Calculate average response time: sum of all response times / number of answered questions
        const totalResponseTime = answersWithResponseTime.reduce(
          (sum, answer) => sum + (answer.responstime || 0),
          0
        );
        const averageResponseTime = totalResponseTime / answersWithResponseTime.length;
        playerAverageResponseTimes.set(playerId, averageResponseTime);
      }
    });

    // Persist per-player battle accuracy and award bonus points (>=80% -> +10)
    for (const playerId of players) {
      const accuracy = playerAccuracies.get(playerId) ?? 0;
      let playerTeamId: string | null = null;
      for (const [teamId, memberIds] of teams.entries()) {
        if (memberIds.includes(playerId)) {
          playerTeamId = teamId;
          break;
        }
      }

      if (!playerTeamId) {
        continue;
      }

      // Get average response time for this player (in seconds)
      const averageResponseTime = playerAverageResponseTimes.get(playerId);

      try {
        await this.teamGameService.recordBattleAccuracyAndPoints(
          playerTeamId,
          playerId,
          accuracy,
          averageResponseTime, // Pass average response time for this game
        );
      } catch (error) {
        // Non-blocking: log and continue finishing game
        console.error('Failed to record team game score', {
          playerId,
          teamId: playerTeamId,
          error,
        });
      }
    }

    // Calculate total response time for each team
    const teamResponseTimeSums: Map<string, number> = new Map();
    teams.forEach((playerIds, teamId) => {
      let totalResponseTime = 0;
      playerIds.forEach((playerId) => {
        const answers = playerAnswers.get(playerId) || [];
        answers.forEach((answer) => {
          // Sum all response times (only for answered questions, ignore null/undefined)
          if (answer.responstime !== undefined && answer.responstime !== null) {
            totalResponseTime += answer.responstime;
          }
        });
      });
      teamResponseTimeSums.set(teamId, totalResponseTime);
    });

    // Get team information (teamName, points) BEFORE awarding points
    // This way we can show the points before the game
    const teamsInfoMapBeforeAward: Map<string, { teamName: string; points: number }> = new Map();
    const teamIds = Array.from(teams.keys());
    if (teamIds.length > 0) {
      try {
        const teamsData = await this.teamModel
          .find({ _id: { $in: teamIds } })
          .select('_id teamName points')
          .lean()
          .exec();
        teamsData.forEach((team: any) => {
          const teamId = this.normalizeId(team._id);
          if (teamId) {
            teamsInfoMapBeforeAward.set(teamId, {
              teamName: (team as any)?.teamName || '',
              points: typeof team.points === 'number' && Number.isFinite(team.points) ? team.points : 0,
            });
          }
        });
      } catch (error) {
        console.error('Failed to fetch team information', error);
      }
    }

    // Determine winner (team with highest score, tiebreaker: lowest response time sum)
    const teamScoresArray = Array.from(teamScores.entries());
    teamScoresArray.sort((a, b) => {
      // Sort by score (descending)
      const scoreDiff = b[1] - a[1];
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      // If scores are equal, sort by response time sum (ascending - lower is better)
      const responseTimeA = teamResponseTimeSums.get(a[0]) || Infinity;
      const responseTimeB = teamResponseTimeSums.get(b[0]) || Infinity;
      return responseTimeA - responseTimeB;
    });

    const winnerTeamId = teamScoresArray.length > 0 ? teamScoresArray[0][0] : null;
    const winnerScore = winnerTeamId ? teamScores.get(winnerTeamId) || 0 : 0;
    
    // Check if there's a tie at the top score
    const topScoreTeams = teamScoresArray.filter(([_, score]) => score === winnerScore);
    
    // Determine final winner: if multiple teams tied on score, use response time tiebreaker
    let finalWinnerTeamId: string | null = null;
    if (topScoreTeams.length > 1) {
      // Multiple teams tied on score - check response times
      const topScoreTeamResponseTimes = topScoreTeams.map(([teamId]) => ({
        teamId,
        responseTime: teamResponseTimeSums.get(teamId) || Infinity,
      }));
      
      // Sort by response time (ascending - lower is better)
      topScoreTeamResponseTimes.sort((a, b) => a.responseTime - b.responseTime);
      
      // Check if there's a unique lowest response time
      const lowestResponseTime = topScoreTeamResponseTimes[0].responseTime;
      const teamsWithLowestResponseTime = topScoreTeamResponseTimes.filter(
        (t) => t.responseTime === lowestResponseTime
      );
      
      if (teamsWithLowestResponseTime.length === 1) {
        // Unique winner based on response time
        finalWinnerTeamId = teamsWithLowestResponseTime[0].teamId;
      } else {
        // Still tied on response time - no winner
        finalWinnerTeamId = null;
      }
    } else {
      // Only one team has the top score
      finalWinnerTeamId = winnerTeamId;
    }

    // Identify loser teams (lowest score). If all teams share the same score (including 0),
    // all team IDs will be included as losers per requirement.
    // Exclude the winner team from loser teams
    const lowestScore = teamScoresArray.length > 0 ? teamScoresArray[teamScoresArray.length - 1][1] : 0;
    const loserTeamIds = teamScoresArray
      .filter(([teamId, score]) => score === lowestScore && teamId !== finalWinnerTeamId)
      .map(([teamId]) => teamId);

    // Award 50 points to the winning team (if a unique winner exists)
    if (finalWinnerTeamId && finalWinnerTeamId !== 'no-team') {
      try {
        await this.teamGameService.incrementTeamPoints(finalWinnerTeamId, 50);
      } catch (error) {
        // Log but do not block game completion
        console.error('Failed to award team win points', error);
      }
    }

    // Get team information (teamName, points) AFTER awarding points (for host view)
    const teamsInfoMap: Map<string, { teamName: string; points: number }> = new Map();
    if (teamIds.length > 0) {
      try {
        const teamsData = await this.teamModel
          .find({ _id: { $in: teamIds } })
          .select('_id teamName points')
          .lean()
          .exec();
        teamsData.forEach((team: any) => {
          const teamId = this.normalizeId(team._id);
          if (teamId) {
            teamsInfoMap.set(teamId, {
              teamName: (team as any)?.teamName || '',
              points: typeof team.points === 'number' && Number.isFinite(team.points) ? team.points : 0,
            });
          }
        });
      } catch (error) {
        console.error('Failed to fetch team information', error);
      }
    }

    // Update game in database
    const playerAnswersArray: Array<{
      userId: string;
      questionIndex: number;
      answer: string;
      isCorrect: boolean;
      timestamp: Date;
    }> = [];

    players.forEach((playerId) => {
      const answers = playerAnswers.get(playerId) || [];
      playerAnswersArray.push(
        ...answers.map((answer) => ({
          userId: playerId,
          questionIndex: answer.index,
          answer: answer.userAnswer ?? '',
          isCorrect: answer.isCorrect,
          timestamp: answer.timestamp ?? new Date(),
        })),
      );
    });

    const scoresObj: Record<string, number> = {};
    teamScores.forEach((score, teamId) => {
      scoresObj[teamId] = score;
    });

    const accuracyObj: Record<string, number> = {};
    teamAccuracies.forEach((accuracy, teamId) => {
      accuracyObj[teamId] = accuracy;
    });

    await this.contentService.completeGame(gameId, {
      currentQuestion: gameState.currentIndex,
      scores: scoresObj,
      playerAnswers: playerAnswersArray,
      lastQuestionTimestamp: new Date(),
      isCompleted: true,
      gameStarted: true,
      accuracy: accuracyObj,
    });

    // Refresh accuracy aggregates for all participants
    try {
      await Promise.all(
        players.map((playerId) =>
          this.teamGameService.refreshMemberAccuracies(playerId),
        ),
      );
    } catch (error) {
      console.error('Failed to refresh member accuracies for team game', error);
    }

    // Update total games played for all players
    await Promise.all(
      players.map((playerId) =>
        this.contentService.incrementTotalGamesPlayed(playerId),
      ),
    );

    // Get player information (name, profileImage) and points for all players
    const playerInfoMap: Map<string, { name: string; profileImage: string | null; points: number }> = new Map();
    const playerPointsMap: Map<string, number> = new Map();
    
    // Fetch all player points from TeamGameScore (need to get teamId for each player first)
    const playerTeamIdMap: Map<string, string> = new Map();
    players.forEach((playerId) => {
      for (const [teamId, playerIds] of teams.entries()) {
        if (playerIds.includes(playerId)) {
          playerTeamIdMap.set(playerId, teamId);
          break;
        }
      }
    });

    // Fetch player points from TeamGameScore
    await Promise.all(
      players.map(async (playerId) => {
        const teamId = playerTeamIdMap.get(playerId);
        if (teamId) {
          try {
            const teamGameScore = await this.teamGameScoreModel
              .findOne({ userId: playerId, teamId: teamId })
              .select('points')
              .lean()
              .exec();
            const points = teamGameScore && typeof (teamGameScore as any).points === 'number' 
              ? (teamGameScore as any).points 
              : 0;
            playerPointsMap.set(playerId, points);
          } catch (error) {
            console.warn(`Failed to fetch player points for ${playerId}`, error);
            playerPointsMap.set(playerId, 0);
          }
        } else {
          playerPointsMap.set(playerId, 0);
        }
      }),
    );

    // Fetch player info (name, profileImage)
    await Promise.all(
      players.map(async (playerId) => {
        try {
          const player = await this.usersService.findById(playerId);
          const points = playerPointsMap.get(playerId) || 0;
          if (player) {
            const userName = (player as any)?.name || (player as any)?.username || '';
            const userProfileImage = (player as any)?.profileImage || null;
            playerInfoMap.set(playerId, {
              name: userName,
              profileImage: userProfileImage,
              points: points,
            });
          } else {
            playerInfoMap.set(playerId, { name: '', profileImage: null, points: points });
          }
        } catch (error) {
          console.warn(`Failed to fetch player info for ${playerId}`, error);
          const points = playerPointsMap.get(playerId) || 0;
          playerInfoMap.set(playerId, { name: '', profileImage: null, points: points });
        }
      }),
    );

    // Calculate team-wise ranks (within each team assign sequential ranks 1,2,3...)
    const playerRankMap: Map<string, number> = new Map();
    for (const [teamId, playerIds] of teams.entries()) {
      // Build array of { playerId, points } for this team
      const teamPlayersWithPoints = playerIds.map((pid) => {
        const info = playerInfoMap.get(pid) || { name: '', profileImage: null, points: 0 };
        return { playerId: pid, points: info.points };
      });

      // Sort descending by points; when points equal, preserve stable order but still assign sequential ranks
      teamPlayersWithPoints.sort((a, b) => b.points - a.points);

      // Assign ranks sequentially within the team
      teamPlayersWithPoints.forEach(({ playerId }, idx) => {
        playerRankMap.set(playerId, idx + 1);
      });
    }

    // Normalize inviterId for comparison
    const normalizedInviterId = this.normalizeId(gameState.inviterId);

    // Determine team result for each team (win/loss/tie)
    const getTeamResult = (teamId: string): 'win' | 'loss' | 'tie' => {
      if (!finalWinnerTeamId) {
        return 'tie'; // No winner means tie
      }
      if (teamId === finalWinnerTeamId) {
        return 'win';
      }
      return 'loss';
    };

    // Extract team points from teamsInfoMap
    const teamPointsObj: Record<string, number> = {};
    teamsInfoMap.forEach((teamInfo, teamId) => {
      teamPointsObj[teamId] = teamInfo.points;
    });

    // Build structured payload matching requested view and send to host (inviter/admin) only
    const teamScoresObj = Object.fromEntries(teamScores);
    const teamAccuracyObj = Object.fromEntries(teamAccuracies);
    const teamResponseTimeSumsObj = Object.fromEntries(teamResponseTimeSums);

    // Match-only points for this match (50 for winner, 0 otherwise)
    const teamMatchPointsObj: Record<string, number> = {};
    for (const tid of teamIds) {
      teamMatchPointsObj[tid] = finalWinnerTeamId && tid === finalWinnerTeamId ? 50 : 0;
    }

    const playerAccuracyObj = Object.fromEntries(playerAccuracies);
    const playerAverageResponseTimesObj = Object.fromEntries(playerAverageResponseTimes);

    // Group player info by team: { teamId: { playerId: { name, profileImage, rank, points } }}
    const playerInfoGrouped: Record<string, Record<string, { name: string; profileImage: string | null; rank: number; points: number }>> = {};
    for (const [teamId, memberIds] of teams.entries()) {
      playerInfoGrouped[teamId] = {};
      for (const memberId of memberIds) {
        const normalizedMemberId = this.normalizeId(memberId);
        if (!normalizedMemberId) continue;
        const pInfo = playerInfoMap.get(memberId) || { name: '', profileImage: null, points: 0 };
        const rank = playerRankMap.get(memberId) || 0;
        playerInfoGrouped[teamId][normalizedMemberId] = {
          name: pInfo.name,
          profileImage: pInfo.profileImage ?? null,
          rank,
          points: pInfo.points ?? 0,
        };
      }
    }

    // Build playerAnswers object keyed by normalized playerId, trimmed to desired fields
    const playerAnswersObj: Record<string, Array<{ index: number; userAnswer: string; correctAnswer: string; isCorrect: boolean; responstime?: number }>> = {};
    for (const playerId of players) {
      const normalizedPlayerId = this.normalizeId(playerId);
      if (!normalizedPlayerId) continue;
      const answers = playerAnswers.get(playerId) || [];
      playerAnswersObj[normalizedPlayerId] = answers.map((a) => ({
        index: a.index,
        userAnswer: a.userAnswer ?? '',
        correctAnswer: a.correctAnswer,
        isCorrect: a.isCorrect,
        responstime: a.responstime,
      }));
    }

    const gameOverData = {
      gameId,
      totalQuestions: questions.length,
      startedAt: gameState.startedAt,
      endedAt: new Date(),
      isCompleted: true,

      winnerTeamId: finalWinnerTeamId,
      loserTeamIds,

      teamScores: teamScoresObj,

      teamAccuracy: teamAccuracyObj,

      teamResponseTimeSums: teamResponseTimeSumsObj,

      // MATCH-ONLY POINTS (NOT TOTAL)
      teamPoints: teamMatchPointsObj,

      playerAccuracy: playerAccuracyObj,

      playerAverageResponseTimes: playerAverageResponseTimesObj,

      // PLAYER INFO GROUPED BY TEAM
      playerInfo: playerInfoGrouped,

      playerAnswers: playerAnswersObj,
    };

    if (normalizedInviterId) {
      const hostSocket = this.userSockets.get(normalizedInviterId);
      if (hostSocket) {
        hostSocket.emit('teamGameOver', gameOverData);
      }
    }

    // Send simplified game over data to each member (non-host players)
    for (const playerId of players) {
      const normalizedPlayerId = this.normalizeId(playerId);
      if (!normalizedPlayerId || normalizedPlayerId === normalizedInviterId) {
        continue; // Skip host
      }

      // Find player's team
      let playerTeamId: string | null = null;
      for (const [teamId, playerIds] of teams.entries()) {
        if (playerIds.includes(normalizedPlayerId)) {
          playerTeamId = teamId;
          break;
        }
      }

      if (!playerTeamId) {
        continue; // Skip if player has no team
      }

      // Get team info (use BEFORE award points for display)
      const teamInfoBefore = teamsInfoMapBeforeAward.get(playerTeamId) || { teamName: '', points: 0 };
      const teamInfo = teamsInfoMap.get(playerTeamId) || { teamName: '', points: 0 };
      const teamScore = teamScores.get(playerTeamId) || 0;
      const teamResult = getTeamResult(playerTeamId);

      // Calculate points gained from this game: 50 if won, 0 if lost/tied
      const myTeamPoints = teamResult === 'win' ? 50 : 0;

      // (team member ids will be collected below)

      // Get player's answers
      const myAnswers = playerAnswers.get(normalizedPlayerId) || [];
      
      // Get player's individual score and accuracy
      const playerScore = myAnswers.filter((a) => a.isCorrect).length;
      const playerAccuracyValue = playerAccuracies.get(normalizedPlayerId) || 0;

      // Get player's average response time
      const playerAverageResponseTime = playerAverageResponseTimes.get(normalizedPlayerId) || 0;

      // Get player info with rank and points for members of this player's team only
      const playerInfoObj: Record<string, { 
        name: string; 
        profileImage: string | null; 
        rank: number; 
        points: number;
      }> = {};

      // teamMemberIds contains original playerIds for this team
      const teamMemberIds = teams.get(playerTeamId) || [];
      const teamMemberCount = teamMemberIds.length;
      teamMemberIds.forEach((memberId) => {
        const normalizedMemberId = this.normalizeId(memberId);
        if (!normalizedMemberId) return;
        const pInfo = playerInfoMap.get(memberId) || { name: '', profileImage: null, points: 0 };
        const rank = playerRankMap.get(memberId) || 0;
        playerInfoObj[normalizedMemberId] = {
          name: pInfo.name,
          profileImage: pInfo.profileImage,
          rank: rank,
          points: pInfo.points,
        };
      });

      // Get current player info for user field
      const currentPlayerInfo = playerInfoMap.get(normalizedPlayerId) || { name: '', profileImage: null, points: 0 };
      const userField = `${normalizedPlayerId}|${currentPlayerInfo.name}`;

      // Get player points from the map
      const playerPoints = currentPlayerInfo.points;

      // Get team response time sum
      const myTeamResponseTimeSum = teamResponseTimeSums.get(playerTeamId) || 0;

      // Get opponent teams information (all teams except player's own team)
      // Use points before award for consistency
      const opponentTeams: Array<{
        teamId: string;
        teamName: string;
        teamPoints: number;
        teamScore: number;
      }> = [];
      
      for (const [teamId, teamInfoData] of teamsInfoMapBeforeAward.entries()) {
        if (teamId !== playerTeamId) {
          const opponentTeamScore = teamScores.get(teamId) || 0;
          // Calculate points gained from this game for opponent team
          const opponentTeamResult = getTeamResult(teamId);
          const opponentTeamPoints = opponentTeamResult === 'win' ? 50 : 0;
          opponentTeams.push({
            teamId: teamId,
            teamName: teamInfoData.teamName,
            teamPoints: opponentTeamPoints, // Points gained from this game
            teamScore: opponentTeamScore,
          });
        }
      }

      // Create member game over data
      const memberGameOverData = {
        gameId,
        roomId: gameState.roomId,
        totalQuestions: questions.length,
        startedAt: gameState.startedAt,
        endedAt: new Date(),
        teamId: playerTeamId,
        teamName: teamInfo.teamName,
        isCompleted: true,
        myTeamResult: teamResult,
        myTeamScore: teamScore,
        myTeamPoints: myTeamPoints, // Points gained from this game (50 if won, 0 if lost/tied)
        teamMemberCount: teamMemberCount, // Add team member count
        myTeamResponseTimeSum: myTeamResponseTimeSum, // Add team response time sum
        myAnswers: myAnswers,
        playerScores: playerScore,
        playerAccuracy: playerAccuracyValue,
        playerAverageResponseTime: playerAverageResponseTime, // Add player average response time
        playerPoints: playerPoints,
        user: userField,
        playerInfo: playerInfoObj, // All players with name, profileImage, rank, points
        opponentTeams: opponentTeams, // Add opponent teams information
      };

      // Emit to this specific member
      const playerSocket = this.userSockets.get(normalizedPlayerId);
      if (playerSocket) {
        playerSocket.emit('gameOver', memberGameOverData);
      }
    }

    // Clean up
    this.teamGames.delete(gameState.roomId);
  }
}

