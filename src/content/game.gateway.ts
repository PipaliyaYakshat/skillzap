import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect, ConnectedSocket, MessageBody, } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ContentService } from './content.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UseFilters } from '@nestjs/common';
import { CustomWsExceptionFilter } from 'src/common/CustomWsExceptionFilter';
import { randomUUID } from 'crypto';
import { Types } from 'mongoose';

type Difficulty = 'easy' | 'medium' | 'hard';

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
};

const QUESTION_TIME_SECONDS = 60;
const QUESTION_TIMEOUT_MS = QUESTION_TIME_SECONDS * 1000;

type InviteUserPayload = {
  userId?: string; // Keep for backward compatibility
  userIds?: string[]; // New: array of user IDs to invite
  deviceId?: string;
  gameMode?: 'DUEL' | 'BRAWL';
  gameId?: string;
};

type AcceptInvitePayload = {
  userId: string;
  deviceId?: string;
  gameId?: string;
};

type CancelInvitePayload = {
  gameId?: string;
  inviterId: string;
};

type AutoInviteState = {
  inviterId: string;
  invitedUserIds: string[];
  currentIndex: number;
  maxUsers: number;
  timeoutIds: NodeJS.Timeout[];
  isGameStarted: boolean;
  gameId?: string;
  mode?: 'DUEL' | 'BRAWL';
  member?: number;
  requiredAcceptances: number; // Number of users that need to accept
  acceptedCount: number; // Current number of accepted users
};

type GameState = {
  gameId: string;
  userId: string;
  subTopicId: string;
  socket: Socket;
  questions: Question[];
  currentIndex: number;
  lives: number;
  score: number;
  answers: AnswerRecord[];
  timer?: NodeJS.Timeout | null;
  startedAt: Date;
  questionStartAt?: Date;
  isCorrect: boolean;
};

type MultiplayerGameState = {
  gameId: string;
  roomId: string;
  players: string[];
  subTopicId: string;
  questions: Question[];
  currentIndex: number;
  playerAnswers: Map<string, AnswerRecord[]>;
  playerScores: Map<string, number>;
  playerWrongAnswers: Map<string, number>; // Track wrong answers count per player
  eliminatedPlayers: Set<string>; // Track eliminated players
  gameMode?: 'Regular' | 'Knockout'; // Track game mode
  startedAt: Date;
  questionStartAt?: Date;
  timer?: NodeJS.Timeout | null;
  isCompleted: boolean;
};

// Type interfaces for lean documents and populated objects
interface UserLean {
  _id: Types.ObjectId;
  name?: string | null;
  username?: string | null;
  profileImage?: string | null;
  coins?: number;
  userType?: string;
}

interface GameMetadata {
  gameMode?: 'Regular' | 'Knockout';
  member?: number;
}

interface GameLean {
  _id: Types.ObjectId;
  gameId?: string;
  metadata?: GameMetadata | unknown;
  eliminatedPlayers?: Array<Types.ObjectId | string>;
  round?: number;
}

@UseFilters(new CustomWsExceptionFilter())
@WebSocketGateway({ cors: { origin: '*' } })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  private userSockets: Map<string, Socket> = new Map();

  private activeGames: Map<string, GameState> = new Map();

  private multiplayerGames: Map<string, MultiplayerGameState> = new Map();

  private autoInviteStates: Map<string, AutoInviteState> = new Map();

  // Store selected random deck per user (userId -> deck object)
  private userSelectedRandomDeck: Map<string, any> = new Map();

  constructor(
    private readonly contentService: ContentService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) { }

  private getISTTime(): string {
    return new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  setUserSockets(sockets: Map<string, Socket>) {
    this.userSockets = sockets;
  }

  private normalizeId<T = unknown>(value: T): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value === 'object' && value !== null && 'toString' in value) {
      const objValue = value as { toString: () => string };
      return objValue.toString();
    }
    return String(value);
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
      const user = await this.usersService.findById(userId);
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
      const user = await this.usersService.findById(userId);
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

          // Check if there's an active multiplayer game for this room
          const multiplayerState = this.multiplayerGames.get(existingRoom.roomId);
          let shouldContinueGame = false;

          // Check if disconnecting user is the host (first participant who created the game)
          const normalizedUserId = this.normalizeId(userId);
          const isHost = normalizedUserId && existingRoom.participants[0] === normalizedUserId;
          console.log('[handleDisconnect] Host check:', {
            userId: normalizedUserId,
            isHost,
            firstParticipant: existingRoom.participants[0],
          });

          if (multiplayerState) {
            // If host disconnects, always end the game regardless of mode
            if (isHost) {
              await this.endMultiplayerGame(multiplayerState, true, userId);
              this.server.to(existingRoom.roomId).emit('gameAborted', {
                message: 'Host disconnected. Game ended.',
                roomId: existingRoom.roomId,
                userId,
              });
            } else {
              // Get game from database to check mode
              const gameModel = this.contentService.getGameModel();
              const game = await gameModel.findOne({ gameId: multiplayerState.gameId }).lean().exec();

              if (game) {
                const isBrawlMode = game.gameMode === 'brawl';
                const remainingPlayers = multiplayerState.players.filter(
                  (p) => this.normalizeId(p) !== normalizedUserId
                );

                // If BRAWL mode and at least 2 players remain, remove user and continue game
                if (isBrawlMode && remainingPlayers.length >= 2) {
                  await this.removePlayerFromGame(multiplayerState, userId, existingRoom.roomId);
                  shouldContinueGame = true;

                  // Notify remaining players in room that a player disconnected but game continues
                  this.server.to(existingRoom.roomId).emit('playerLeftGame', {
                    message: 'A player disconnected from the game',
                    roomId: existingRoom.roomId,
                    gameId: multiplayerState.gameId,
                    leavingUserId: userId,
                    remainingPlayers: remainingPlayers,
                    gameContinues: true,
                  });
                } else {
                  // End the game without awarding points and coins
                  // Mark disconnecting user as loser and remaining player as winner
                  await this.endMultiplayerGame(multiplayerState, true, userId);

                  // Notify all players in room that game was aborted
                  this.server.to(existingRoom.roomId).emit('gameAborted', {
                    message: 'A player disconnected from the room',
                    roomId: existingRoom.roomId,
                    userId,
                  });
                }
              } else {
                // If game not found in DB, end the game
                await this.endMultiplayerGame(multiplayerState, true, userId);
                this.server.to(existingRoom.roomId).emit('gameAborted', {
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

        // Clean up auto-invite state if user disconnects
        const normalizedUserId = this.normalizeId(userId);
        if (normalizedUserId) {
          const autoInviteState = this.autoInviteStates.get(normalizedUserId);
          if (autoInviteState) {
            console.log('[handleDisconnect] Cleaning up auto-invite state:', {
              userId: normalizedUserId,
              timeoutIds: autoInviteState.timeoutIds.length,
            });
            // Clear all pending timeouts
            autoInviteState.timeoutIds.forEach((timeoutId) => clearTimeout(timeoutId));
            this.autoInviteStates.delete(normalizedUserId);
          }

          // Clean up stored random deck
          this.userSelectedRandomDeck.delete(normalizedUserId);
        }

        // if the user has an active single-player game, gracefully end it
        const game = this.activeGames.get(userId);
        if (game) {
          console.log('[handleDisconnect] Ending active single-player game:', {
            userId,
            gameId: game.gameId,
            score: game.score,
          });
          // clear timer
          if (game.timer) clearTimeout(game.timer);
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

        // notify other systems if needed
        // this.server.emit('USER_OFFLINE', { userId, lastSeen: now });
        // console.log('[handleDisconnect] Disconnect process completed:', { userId });
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
  // START GAME
  // Client emits: START_GAME { subTopicId, difficulty? }
  // -------------------------------------------------------------
  @SubscribeMessage('singlePlayCreateGame')
  async startGame(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { subTopicId: string; difficulty?: string },
  ) {
    const userId = client.data.userId as string;
    console.log('[singlePlayCreateGame] Event received:', {
      userId,
      body,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[singlePlayCreateGame] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    // Check if user is blocked
    const { isBlocked } = await this.checkUserIsBlocked(userId);
    if (isBlocked) {
      console.log('[singlePlayCreateGame] Error: User account is blocked:', { userId });
      return client.emit('errorMessage', { message: 'Your account is blocked' });
    }

    // Check if user is online
    const isOnline = await this.checkUserIsOnline(userId);
    console.log('[singlePlayCreateGame] User online status:', { userId, isOnline });
    if (!isOnline) {
      console.log('[singlePlayCreateGame] Error: User is not online');
      return client.emit('errorMessage', {
        message: 'You must be online to play games. Please set your status to online.',
      });
    }

    const user = await this.usersService.findById(userId);

    if (!user) {
      console.log('[singlePlayCreateGame] Error: User not found:', { userId });
      return client.emit('errorMessage', { message: 'User not found' });
    }

    // Prevent duplicate game
    if (this.activeGames.has(userId)) {
      console.log('[singlePlayCreateGame] Error: Game already in progress:', { userId });
      return client.emit('errorMessage', {
        message: 'Game already in progress',
      });
    }

    const { subTopicId, difficulty = 'easy' } = body as {
      subTopicId: string;
      difficulty?: Difficulty;
    };

    if (!subTopicId) {
      console.log('[singlePlayCreateGame] Error: subTopicId is required');
      return client.emit('errorMessage', { message: 'subTopicId is required' });
    }

    console.log('[singlePlayCreateGame] Creating single-player game:', {
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
      } = await this.contentService.singlePlayCreateGame(
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
      const userTyped = user as unknown as UserLean;
      const userCoins =
        typeof userTyped?.coins === 'number' && Number.isFinite(userTyped.coins)
          ? userTyped.coins
          : 0;

      const gameState: GameState = {
        gameId,
        userId,
        subTopicId: normalizedSubTopicId,
        socket: client,
        questions,
        currentIndex: 0,
        lives: Number.isInteger(user.lives) && user.lives > 0 ? user.lives : 0,
        score: 0,
        answers: [],
        timer: null,
        startedAt: new Date(),
        isCorrect: false,
      };
      this.activeGames.set(userId, gameState);

      console.log('[singlePlayCreateGame] Game created successfully:', {
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
      console.log('[singlePlayCreateGame] Game start event emitted');
    } catch (err) {
      console.error('[singlePlayCreateGame] Error occurred:', {
        userId,
        error: err.message,
        stack: err.stack,
        body,
      });
      client.emit('errorMessage', { message: 'Failed to start game' });
    }
  }

  // -------------------------------------------------------------
  // CREATE AND START MULTIPLAYER GAME
  // Client emits: createGame { mode, topicType?, deckId? }
  // Only host (inviter) can create game after room is created
  // Game will automatically start after creation
  // -------------------------------------------------------------
  @SubscribeMessage('createGame')
  async createGame(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: {
      mode: 'DUEL' | 'BRAWL';
      topicType?: 'random' | 'selected';
      deckId?: string;
      gameMode?: 'Regular' | 'Knockout';
      member?: number;
    },
  ) {
    const userId = client.data.userId as string;
    console.log('[createGame] Event received:', {
      userId,
      body,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[createGame] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    // Check if user is blocked
    const { isBlocked } = await this.checkUserIsBlocked(userId);
    if (isBlocked) {
      console.log('[createGame] Error: User account is blocked:', { userId });
      return client.emit('errorMessage', { message: 'Your account is blocked' });
    }

    // Check if user is online
    const isOnline = await this.checkUserIsOnline(userId);
    console.log('[createGame] User online status:', { userId, isOnline });
    if (!isOnline) {
      console.log('[createGame] Error: User is not online');
      return client.emit('errorMessage', {
        message: 'You must be online to create games. Please set your status to online.',
      });
    }

    const { mode, topicType, deckId, gameMode, member } = body;
    console.log('[createGame] Extracted parameters:', {
      mode,
      topicType,
      deckId,
      gameMode,
      member,
    });

    // Validate mode
    if (!mode || (mode !== 'DUEL' && mode !== 'BRAWL')) {
      console.log('[createGame] Error: Invalid mode:', { mode });
      return client.emit('errorMessage', {
        message: 'mode must be either "DUEL" or "BRAWL"',
      });
    }

    // If topicType is 'random', check if user has a stored random deck from randomDeckSelected
    let finalTopicType = topicType;
    let finalDeckId = deckId;
    const normalizedUserId = this.normalizeId(userId);
    console.log('[createGame] Checking for stored random deck:', {
      topicType,
      normalizedUserId,
      hasStoredDeck: normalizedUserId ? this.userSelectedRandomDeck.has(normalizedUserId) : false,
    });

    if (topicType === 'random' && normalizedUserId) {
      const storedRandomDeck = this.userSelectedRandomDeck.get(normalizedUserId);
      if (storedRandomDeck) {
        // Use the stored random deck as if it was selected
        finalTopicType = 'selected';
        finalDeckId = this.normalizeId(storedRandomDeck._id) || this.normalizeId(storedRandomDeck.id) || deckId;
        console.log('[createGame] Using stored random deck:', {
          finalTopicType,
          finalDeckId,
          storedDeckId: storedRandomDeck._id || storedRandomDeck.id,
        });

        // Clear the stored deck after using it (optional - you can keep it if you want to reuse)
        // this.userSelectedRandomDeck.delete(normalizedUserId);
      }
    }

    // Validate topicType and deckId
    if (finalTopicType === 'selected' && !finalDeckId) {
      console.log('[createGame] Error: deckId required for selected topicType:', {
        finalTopicType,
        finalDeckId,
      });
      return client.emit('errorMessage', {
        message: 'deckId is required when topicType is "selected". Please select a random deck first or provide deckId.',
      });
    }

    // Validate BRAWL mode requirements
    if (mode === 'BRAWL') {
      console.log('[createGame] Validating BRAWL mode requirements:', {
        gameMode,
        member,
      });
      if (!gameMode) {
        console.log('[createGame] Error: gameMode required for BRAWL');
        return client.emit('errorMessage', {
          message: 'gameMode is required when mode is "BRAWL"',
        });
      }

      if (!member) {
        console.log('[createGame] Error: member required for BRAWL');
        return client.emit('errorMessage', {
          message: 'member is required when mode is "BRAWL"',
        });
      }

      if (member !== 3 && member !== 4) {
        console.log('[createGame] Error: Invalid member count for BRAWL:', { member });
        return client.emit('errorMessage', {
          message: 'member must be either 3 or 4 when mode is "BRAWL"',
        });
      }
    }

    try {
      // Check if user is in an active room
      const room = this.contentService.getRoomByUserId(userId);
      console.log('[createGame] Room check:', {
        userId,
        hasRoom: !!room,
        roomId: room?.roomId,
        participants: room?.participants,
      });
      if (!room) {
        console.log('[createGame] Error: User not in a room');
        return client.emit('errorMessage', {
          message: 'You must be in a room to create a game. Accept an invite first.',
        });
      }

      // Check if user is the host (inviter)
      const normalizedUserId = this.normalizeId(userId);
      const isHost = room.participants[0] === normalizedUserId;
      console.log('[createGame] Host check:', {
        userId: normalizedUserId,
        firstParticipant: room.participants[0],
        isHost,
      });
      if (!isHost) {
        console.log('[createGame] Error: Only host can create game');
        return client.emit('errorMessage', {
          message: 'Only the host can create the game',
        });
      }

      // Validate DUEL mode requires exactly 2 players
      if (mode === 'DUEL' && room.participants.length !== 2) {
        console.log('[createGame] Error: DUEL mode requires exactly 2 players:', {
          mode,
          currentPlayers: room.participants.length,
          participants: room.participants,
        });
        return client.emit('errorMessage', {
          message: 'DUEL mode requires exactly 2 players. Current players: ' + room.participants.length,
        });
      }

      // Validate BRAWL mode requires matching number of players
      if (mode === 'BRAWL') {
        console.log('[createGame] Validating BRAWL player count:', {
          member,
          currentPlayers: room.participants.length,
          participants: room.participants,
        });
        if (member === 3 && room.participants.length !== 3) {
          console.log('[createGame] Error: BRAWL 3 members requires exactly 3 players');
          return client.emit('errorMessage', {
            message: 'BRAWL mode with 3 members requires exactly 3 players. Current players: ' + room.participants.length,
          });
        }
        if (member === 4 && room.participants.length !== 4) {
          console.log('[createGame] Error: BRAWL 4 members requires exactly 4 players');
          return client.emit('errorMessage', {
            message: 'BRAWL mode with 4 members requires exactly 4 players. Current players: ' + room.participants.length,
          });
        }
      }

      // Check if game already exists for this room
      const gameExists = this.multiplayerGames.has(room.roomId);
      console.log('[createGame] Checking if game already exists:', {
        roomId: room.roomId,
        gameExists,
        existingGames: Array.from(this.multiplayerGames.keys()),
      });
      if (gameExists) {
        console.log('[createGame] Error: Game already exists for room');
        return client.emit('errorMessage', {
          message: 'Game already created for this room',
        });
      }

      // Create game in database
      console.log('[createGame] Creating multiplayer game in database:', {
        userId,
        mode,
        finalTopicType,
        finalDeckId,
        roomId: room.roomId,
        participants: room.participants,
        gameMode,
        member,
      });
      const result = await this.contentService.createMultiplayerGame(
        userId,
        mode,
        finalTopicType,
        finalDeckId,
        room.roomId,
        room.participants,
        gameMode,
        member,
      );
      console.log('[createGame] Game created in database:', {
        result,
        gameId: result.gameId,
        deckId: result.deckId,
        deckName: result.deckName,
      });

      // Get game from database to start it
      const gameModel = this.contentService.getGameModel();
      const game = await gameModel.findOne({ gameId: result.gameId }).lean().exec();

      if (!game) {
        console.error('[createGame] Error: Game not found after creation:', {
          gameId: result.gameId,
        });
        return client.emit('errorMessage', { message: 'Game not found after creation' });
      }
      console.log('[createGame] Game retrieved from database:', {
        gameId: game.gameId,
        subTopicId: game.subTopicId,
        players: game.players,
        difficulty: game.difficulty,
      });

      // Clear stored random deck after successful game creation (so next randomDeckSelected gets fresh deck)
      if (normalizedUserId && topicType === 'random') {
        console.log('[createGame] Clearing stored random deck:', { normalizedUserId });
        this.userSelectedRandomDeck.delete(normalizedUserId);
      }

      // Generate questions for the subtopic
      console.log('[createGame] Getting subtopic and topic:', {
        subTopicId: game.subTopicId,
      });
      const { subTopic, topic } = await this.contentService.getSubTopicAndTopic(
        game.subTopicId,
      );
      console.log('[createGame] Subtopic and topic retrieved:', {
        subTopicTitle: subTopic.title,
        topicId: this.normalizeId(topic._id),
      });

      // Calculate topicId, subTopicIndex and totalSubTopics (same as single-player)
      const topicId = this.normalizeId(topic._id) as string;
      const orderedSubTopicIds = (topic.subTopics ?? [])
        .map((id) => this.normalizeId(id))
        .filter((id): id is string => !!id);
      const normalizedSubTopicId = this.normalizeId(game.subTopicId) as string;
      const subTopicIndex =
        orderedSubTopicIds.findIndex((id) => id === normalizedSubTopicId) + 1;
      const totalSubTopics = orderedSubTopicIds.length;
      console.log('[createGame] Calculated topic info:', {
        topicId,
        normalizedSubTopicId,
        subTopicIndex,
        totalSubTopics,
        orderedSubTopicIds,
      });

      const aiService = this.contentService.getAiService();
      console.log('[createGame] Generating MCQ questions:', {
        subTopicTitle: subTopic.title,
        difficulty: game.difficulty || 'medium',
      });
      const questions = await aiService.generateMCQQuestions(
        subTopic.title,
        subTopic.description,
        game.difficulty || 'medium',
      );
      console.log('[createGame] Questions generated:', {
        questionCount: questions.length,
        isArray: Array.isArray(questions),
      });

      if (!Array.isArray(questions) || questions.length === 0) {
        console.error('[createGame] Error: No questions generated');
        return client.emit('errorMessage', {
          message: 'No questions available for this topic',
        });
      }

      // Update game with questions and mark as started
      console.log('[createGame] Updating game with questions:', {
        gameId: result.gameId,
        questionCount: questions.length,
      });
      await gameModel.updateOne(
        { gameId: result.gameId },
        {
          $set: {
            questions,
            gameStarted: true,
            startTime: new Date(),
            currentQuestion: 0,
            round: 1, // Set round to 1 for new game
          },
        },
      );
      console.log('[createGame] Game updated in database with round: 1');

      // Create multiplayer game state
      const multiplayerState: MultiplayerGameState = {
        gameId: result.gameId,
        roomId: room.roomId,
        players: game.players,
        subTopicId: game.subTopicId,
        questions,
        currentIndex: 0,
        playerAnswers: new Map(),
        playerScores: new Map(),
        playerWrongAnswers: new Map(),
        eliminatedPlayers: new Set(),
        gameMode: (game.metadata as unknown as GameMetadata)?.gameMode as 'Regular' | 'Knockout' | undefined,
        startedAt: new Date(),
        isCompleted: false,
      };
      console.log('[createGame] Created multiplayer game state:', {
        gameId: multiplayerState.gameId,
        roomId: multiplayerState.roomId,
        players: multiplayerState.players,
        gameMode: multiplayerState.gameMode,
      });

      // Initialize scores and wrong answers for all players
      game.players.forEach((playerId) => {
        multiplayerState.playerScores.set(playerId, 0);
        multiplayerState.playerAnswers.set(playerId, []);
        multiplayerState.playerWrongAnswers.set(playerId, 0);
      });
      console.log('[createGame] Initialized player scores and answers:', {
        players: game.players,
        playerScores: Array.from(multiplayerState.playerScores.entries()),
      });

      this.multiplayerGames.set(room.roomId, multiplayerState);
      console.log('[createGame] Game state stored in multiplayerGames:', {
        roomId: room.roomId,
        totalGames: this.multiplayerGames.size,
      });

      // Ensure all participants are joined to the room
      console.log('[createGame] Joining participants to room:', {
        roomId: room.roomId,
        participants: room.participants,
      });
      room.participants.forEach((participantId) => {
        const participantSocket = this.userSockets.get(participantId);
        if (participantSocket) {
          console.log('[createGame] Joining participant to room:', {
            participantId,
            roomId: room.roomId,
            socketId: participantSocket.id,
          });
          participantSocket.join(room.roomId);
        } else {
          console.warn('[createGame] Participant socket not found:', {
            participantId,
            availableSockets: Array.from(this.userSockets.keys()),
          });
        }
      });

      // Get host user to mirror single-player lives field
      console.log('[createGame] Getting host user info:', { userId });
      const hostUser = await this.usersService.findById(userId);
      const hostLives =
        hostUser && Number.isInteger(hostUser.lives) && hostUser.lives > 0
          ? hostUser.lives
          : 0;
      console.log('[createGame] Host lives:', { hostLives });

      // Build per-player coins map: { [userId]: coins }
      const playerCoins: Record<string, number> = {};
      // Build per-player user info map: { [userId]: { name, profileImage, isHost } }
      const playerInfo: Record<string, { name: string; profileImage: string | null; isHost: boolean }> = {};
      // Build per-player points map: { [userId]: points }
      const playerPoints: Record<string, number> = {};
      // Build per-player level map: { [userId]: { levelName, name } }
      const playerLevel: Record<string, { levelName: string; name: string }> = {};
      // Build per-player winner rate map: { [userId]: winnerRate }
      const winnerRate: Record<string, number> = {};
      // Get host ID (first participant)
      const hostId = this.normalizeId(room.participants[0]);
      console.log('[createGame] Fetching player coins and info:', {
        participants: room.participants,
        hostId,
      });

      // Batch fetch all users and game progress
      const participantIds = room.participants
        .map(p => this.normalizeId(p))
        .filter((id): id is string => !!id);

      const userModel = this.contentService.getUserModel();
      const gameProgressModel = this.contentService.getGameProgressModel();

      // 1. Fetch all users in one query
      const allUsers = await userModel
        .find({ _id: { $in: participantIds } })
        .lean()
        .exec();

      // 2. Fetch all game progress in one query
      const allGameProgress = await gameProgressModel
        .find({ userId: { $in: participantIds } })
        .lean()
        .exec();

      // 3. Create maps
      const usersMap = new Map(allUsers.map(u => [this.normalizeId(u._id) || '', u]));
      const progressMap = new Map(
        allGameProgress.map(gp => [this.normalizeId(gp.userId) || '', gp])
      );

      // 4. Process participants using maps (no queries)
      participantIds.forEach((normalizedId) => {
        const player = usersMap.get(normalizedId);
        const gameProgress = progressMap.get(normalizedId);

        try {
          const playerTyped = player as unknown as UserLean;
          const coins =
            player &&
            typeof playerTyped?.coins === 'number' &&
            Number.isFinite(playerTyped.coins)
              ? playerTyped.coins
              : 0;
          playerCoins[normalizedId] = coins;

          // Get user name and profile image
          const userName = playerTyped?.name || playerTyped?.username || '';
          const userProfileImage = playerTyped?.profileImage || null;
          // Check if this player is the host (first participant)
          const isHost = normalizedId === hostId;
          playerInfo[normalizedId] = {
            name: userName,
            profileImage: userProfileImage,
            isHost: isHost,
          };

          // Get GameProgress for points, level, and winner rate
          if (gameProgress) {
            // Points
            const points = typeof gameProgress.points === 'number' && Number.isFinite(gameProgress.points)
              ? gameProgress.points
              : 0;
            playerPoints[normalizedId] = points;

            // Level name with name
            const level = typeof gameProgress.level === 'number' && Number.isFinite(gameProgress.level)
              ? gameProgress.level
              : 1;
            const levelName = this.contentService.getLevelNameForLevel(level);
            playerLevel[normalizedId] = {
              levelName: levelName,
              name: userName,
            };

            // Winner rate: totalWins / totalGamesPlayed
            const totalWins = typeof gameProgress.totalWins === 'number' && Number.isFinite(gameProgress.totalWins)
              ? gameProgress.totalWins
              : 0;
            const totalGamesPlayed = typeof gameProgress.totalGamesPlayed === 'number' && Number.isFinite(gameProgress.totalGamesPlayed)
              ? gameProgress.totalGamesPlayed
              : 0;
            const calculatedWinnerRate = totalGamesPlayed > 0 ? (totalWins / totalGamesPlayed) : 0;
            // Round to 2 decimal places
            winnerRate[normalizedId] = Math.round(calculatedWinnerRate * 100) / 100;
          } else {
            // Default values if GameProgress not found
            playerPoints[normalizedId] = 0;
            playerLevel[normalizedId] = {
              levelName: 'Awakened', // Default level name for level 1
              name: userName,
            };
            winnerRate[normalizedId] = 0;
          }

          console.log('[createGame] Player info fetched:', {
            playerId: normalizedId,
            coins,
            name: userName,
            hasProfileImage: !!userProfileImage,
            points: playerPoints[normalizedId],
            levelName: playerLevel[normalizedId]?.levelName,
            winnerRate: winnerRate[normalizedId],
          });
        } catch (error) {
          console.warn('[createGame] Failed to fetch player info:', {
            playerId: normalizedId,
            error: error.message,
          });
          playerCoins[normalizedId] = 0;
          // Check if this player is the host (first participant)
          const isHost = normalizedId === hostId;
          playerInfo[normalizedId] = {
            name: '',
            profileImage: null,
            isHost: isHost,
          };
          playerPoints[normalizedId] = 0;
          playerLevel[normalizedId] = {
            levelName: 'Awakened', // Default level name for level 1
            name: '',
          };
          winnerRate[normalizedId] = 0;
        }
      });
      console.log('[createGame] Player coins and info collected:', {
        playerCoins,
        playerInfo,
        playerPoints,
        playerLevel,
        winnerRate,
      });

      // Notify all players that game is created (global emit as per your change)
      // NOTE: We send full game metadata here (like single-player gameStart),
      // and DO NOT send a separate gameStart payload for createGame.
      const gameCreatedPayload = {
        success: true,
        gameId: result.gameId,
        roomId: room.roomId,
        deckId: result.deckId,
        deckName: result.deckName,
        topicId,
        subTopicId: normalizedSubTopicId,
        totalQuestions: questions.length,
        lives: hostLives,
        timePerQuestion: QUESTION_TIME_SECONDS,
        subTopicIndex,
        totalSubTopics,
        round: 1, // Round is always 1 for new game
        // coins per player, e.g. { "userId1": 10, "userId2": 5 }
        coins: playerCoins,
        // player info per player, e.g. { "userId1": { name: "John", profileImage: "url" }, "userId2": { name: "Jane", profileImage: "url" } }
        playerInfo: playerInfo,
        // player points per player, e.g. { "userId1": 100, "userId2": 50 }
        playerPoints: playerPoints,
        // player level per player with name, e.g. { "userId1": { levelName: "Catalysts", name: "John" }, "userId2": { levelName: "Pathfinders", name: "Jane" } }
        playerLevel: playerLevel,
        // winner rate per player (totalWins / totalGamesPlayed), e.g. { "userId1": 0.75, "userId2": 0.50 }
        winnerRate: winnerRate,
        questions,
        mode,
        topicType: finalTopicType || topicType || 'random',
        players: room.participants,
        gameMode: gameMode || undefined,
        member: member || undefined,
      };
      console.log('[createGame] Emitting gameCreated event to room:', {
        roomId: room.roomId,
        gameId: result.gameId,
        participants: room.participants,
        payload: {
          ...gameCreatedPayload,
          questions: `[${questions.length} questions]`, // Don't log full questions array
        },
      });
      // Emit to room, not globally - ensures only users in the room receive it
      this.server.to(room.roomId).emit('gameCreated', gameCreatedPayload);
      console.log('[createGame] Game creation process completed successfully');
    } catch (error) {
      console.error('[createGame] Error occurred:', {
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
  // RESTART MULTIPLAYER GAME
  // Client emits: restartGame { roomId }
  // Only host can restart the game
  // Creates a new game with same parameters and starts it automatically
  // Includes eliminated players but excludes players who left
  // -------------------------------------------------------------
  @SubscribeMessage('restartGame')
  async restartGame(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomId: string },
  ) {
    const userId = client.data.userId as string;
    console.log('[restartGame] Event received:', {
      userId,
      body,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[restartGame] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    // Check if user is online
    const isOnline = await this.checkUserIsOnline(userId);
    console.log('[restartGame] User online status:', { userId, isOnline });
    if (!isOnline) {
      console.log('[restartGame] Error: User is not online');
      return client.emit('errorMessage', {
        message: 'You must be online to restart games. Please set your status to online.',
      });
    }

    const { roomId } = body;

    if (!roomId) {
      console.log('[restartGame] Error: roomId is required');
      return client.emit('errorMessage', { message: 'roomId is required' });
    }

    console.log('[restartGame] Restarting game:', { userId, roomId });

    try {
      // Check if user is in an active room
      const room = this.contentService.getRoomByRoomId(roomId);
      if (!room) {
        return client.emit('errorMessage', {
          message: 'Room not found',
        });
      }

      // Check if user is the host (inviter)
      const normalizedUserId = this.normalizeId(userId);
      if (room.participants[0] !== normalizedUserId) {
        return client.emit('errorMessage', {
          message: 'Only the host can restart the game',
        });
      }

      // Get existing game state from memory (if available)
      const existingState = this.multiplayerGames.get(roomId);

      // Get existing game from database
      const gameModel = this.contentService.getGameModel();
      let existingGame: any = null;

      // First, try to find game using gameId from existing state (if available)
      if (existingState?.gameId) {
        existingGame = await gameModel.findOne({ gameId: existingState.gameId }).lean().exec();
        console.log('[restartGame] Found game from existing state:', {
          gameId: existingState.gameId,
          found: !!existingGame,
        });
      }

      // If not found and we have existing state, that's an error
      if (!existingGame && existingState) {
        console.error('[restartGame] Game state exists but game not found in database:', {
          gameId: existingState.gameId,
          roomId,
        });
        return client.emit('errorMessage', {
          message: 'Previous game not found in database',
        });
      }

      // If no existing state, try to find the most recent completed game for players in this room
      if (!existingGame) {
        const normalizedRoomParticipants = room.participants
          .map(p => this.normalizeId(p))
          .filter((id): id is string => !!id);

        console.log('[restartGame] Searching for game by participants:', {
          participants: normalizedRoomParticipants,
        });

        // Find most recent game where all room participants were players
        existingGame = await gameModel
          .findOne({
            players: { $all: normalizedRoomParticipants },
            $expr: { $eq: [{ $size: '$players' }, normalizedRoomParticipants.length] },
          })
          .sort({ startTime: -1 })
          .lean()
          .exec();

        // If still not found, try with $in (any of the participants)
        if (!existingGame) {
          existingGame = await gameModel
            .findOne({
              players: { $in: normalizedRoomParticipants },
            })
            .sort({ startTime: -1 })
            .lean()
            .exec();
        }

        console.log('[restartGame] Game search result:', {
          found: !!existingGame,
          gameId: existingGame?.gameId,
        });
      }

      if (!existingGame) {
        return client.emit('errorMessage', {
          message: 'Previous game not found. Please create a new game.',
        });
      }

      // Get eliminated players from previous game (from database or game state)
      const existingGameTyped = existingGame as unknown as GameLean;
      const eliminatedPlayersFromDB: string[] = Array.isArray(existingGameTyped.eliminatedPlayers)
        ? existingGameTyped.eliminatedPlayers.map((id) => this.normalizeId(id)).filter((id): id is string => !!id)
        : [];

      const eliminatedPlayersFromState = existingState
        ? Array.from(existingState.eliminatedPlayers).map(id => this.normalizeId(id)).filter((id): id is string => !!id)
        : [];

      // Combine eliminated players from both sources
      const allEliminatedPlayers = Array.from(new Set([
        ...eliminatedPlayersFromDB,
        ...eliminatedPlayersFromState,
      ]));

      console.log('[restartGame] Eliminated players found:', {
        fromDB: eliminatedPlayersFromDB,
        fromState: eliminatedPlayersFromState,
        allEliminated: allEliminatedPlayers,
      });

      // Build list of players to include in restart:
      // 1. Current room participants (always included)
      // 2. Eliminated players who are still connected (have active socket)
      const playersToInclude = new Set<string>(room.participants.map(p => this.normalizeId(p)).filter((id): id is string => !!id));

      // Add eliminated players who are still connected (have socket)
      allEliminatedPlayers.forEach((eliminatedPlayerId) => {
        if (this.userSockets.has(eliminatedPlayerId)) {
          playersToInclude.add(eliminatedPlayerId);
          console.log('[restartGame] Including eliminated player (still connected):', {
            eliminatedPlayerId,
          });
        } else {
          console.log('[restartGame] Excluding eliminated player (not connected):', {
            eliminatedPlayerId,
          });
        }
      });

      const finalPlayersList = Array.from(playersToInclude);

      console.log('[restartGame] Final players list for restart:', {
        roomParticipants: room.participants,
        eliminatedPlayers: allEliminatedPlayers,
        finalPlayersList,
      });

      if (finalPlayersList.length === 0) {
        return client.emit('errorMessage', {
          message: 'No players available to restart game',
        });
      }

      // Clear existing multiplayer game state if it exists
      if (this.multiplayerGames.has(roomId)) {
        const stateToClear = this.multiplayerGames.get(roomId);
        if (stateToClear?.timer) {
          clearTimeout(stateToClear.timer);
        }
        this.multiplayerGames.delete(roomId);
      }

      // Extract game parameters from existing game (reuse existingGameTyped from above)
      const mode = existingGame.gameMode?.toUpperCase() as 'DUEL' | 'BRAWL' || 'DUEL';
      const topicType = existingGame.deckSelectionMethod || 'random';
      const deckId = existingGame.selectedDeckId || undefined;
      const gameMetadata = existingGameTyped.metadata as unknown as GameMetadata;
      const gameMode = gameMetadata?.gameMode as 'Regular' | 'Knockout' | undefined;
      const member = gameMetadata?.member as number | undefined;

      // Get previous round and increment it
      const previousRound = typeof existingGameTyped.round === 'number'
        ? existingGameTyped.round
        : 1;
      const newRound = previousRound + 1;
      console.log('[restartGame] Round calculation:', {
        previousRound,
        newRound,
        gameId: existingGame.gameId,
      });

      // Generate new gameId for the restarted game (to avoid duplicate key error)
      const newGameId = randomUUID();

      // Create new game in database with same parameters but new gameId
      // Use finalPlayersList which includes room participants + connected eliminated players
      const result = await this.contentService.createMultiplayerGame(
        userId,
        mode,
        topicType,
        deckId,
        newGameId, // Pass new gameId instead of room.roomId
        finalPlayersList, // Use final players list (includes eliminated but not left players)
        gameMode,
        member,
      );

      // Get new game from database to start it
      const newGame = await gameModel.findOne({ gameId: result.gameId }).lean().exec();

      if (!newGame) {
        return client.emit('errorMessage', {
          message: 'Game not found after creation',
        });
      }

      // Generate questions for the subtopic
      const { subTopic: newSubTopic, topic: newTopic } =
        await this.contentService.getSubTopicAndTopic(newGame.subTopicId);

      // Calculate topicId, subTopicIndex and totalSubTopics (same as single-player)
      const newTopicId = this.normalizeId(newTopic._id) as string;
      const newOrderedSubTopicIds = (newTopic.subTopics ?? [])
        .map((id) => this.normalizeId(id))
        .filter((id): id is string => !!id);
      const newNormalizedSubTopicId = this.normalizeId(
        newGame.subTopicId,
      ) as string;
      const newSubTopicIndex =
        newOrderedSubTopicIds.findIndex((id) => id === newNormalizedSubTopicId) +
        1;
      const newTotalSubTopics = newOrderedSubTopicIds.length;

      const aiService = this.contentService.getAiService();
      const questions = await aiService.generateMCQQuestions(
        newSubTopic.title,
        newSubTopic.description,
        newGame.difficulty || 'medium',
      );

      if (!Array.isArray(questions) || questions.length === 0) {
        return client.emit('errorMessage', {
          message: 'No questions available for this topic',
        });
      }

      // Update game with questions and mark as started
      await gameModel.updateOne(
        { gameId: result.gameId },
        {
          $set: {
            questions,
            gameStarted: true,
            startTime: new Date(),
            currentQuestion: 0,
            round: newRound, // Set incremented round for restarted game
          },
        },
      );
      console.log('[restartGame] Game updated in database with round:', newRound);

      // Create multiplayer game state
      const newGameTyped = newGame as unknown as GameLean;
      const newGameMetadata = newGameTyped.metadata as unknown as GameMetadata;
      const multiplayerState: MultiplayerGameState = {
        gameId: result.gameId,
        roomId: room.roomId,
        players: newGame.players,
        subTopicId: newGame.subTopicId,
        questions,
        currentIndex: 0,
        playerAnswers: new Map(),
        playerScores: new Map(),
        playerWrongAnswers: new Map(),
        eliminatedPlayers: new Set(),
        gameMode: newGameMetadata?.gameMode as 'Regular' | 'Knockout' | undefined,
        startedAt: new Date(),
        isCompleted: false,
      };

      // Initialize scores and wrong answers for all players
      newGame.players.forEach((playerId) => {
        multiplayerState.playerScores.set(playerId, 0);
        multiplayerState.playerAnswers.set(playerId, []);
        multiplayerState.playerWrongAnswers.set(playerId, 0);
      });

      this.multiplayerGames.set(roomId, multiplayerState);

      // Get host user to mirror single-player lives field
      console.log('[restartGame] Getting host user info:', { userId });
      const hostUser = await this.usersService.findById(userId);
      const hostLives =
        hostUser && Number.isInteger(hostUser.lives) && hostUser.lives > 0
          ? hostUser.lives
          : 0;
      console.log('[restartGame] Host lives:', { hostLives });

      // Build per-player coins map: { [userId]: coins }
      const playerCoins: Record<string, number> = {};
      // Build per-player user info map: { [userId]: { name, profileImage, isHost } }
      const playerInfo: Record<string, { name: string; profileImage: string | null; isHost: boolean }> = {};
      // Build per-player points map: { [userId]: points }
      const playerPoints: Record<string, number> = {};
      // Build per-player level map: { [userId]: { levelName, name } }
      const playerLevel: Record<string, { levelName: string; name: string }> = {};
      // Build per-player winner rate map: { [userId]: winnerRate }
      const winnerRate: Record<string, number> = {};
      // Get host ID (first participant)
      const hostId = this.normalizeId(room.participants[0]);
      console.log('[restartGame] Fetching player coins and info:', {
        finalPlayersList,
        hostId,
      });

      // Batch fetch all users and game progress
      const participantIds = finalPlayersList
        .map(p => this.normalizeId(p))
        .filter((id): id is string => !!id);

      const userModel = this.contentService.getUserModel();
      const gameProgressModel = this.contentService.getGameProgressModel();

      // 1. Fetch all users in one query
      const allUsers = await userModel
        .find({ _id: { $in: participantIds } })
        .lean()
        .exec();

      // 2. Fetch all game progress in one query
      const allGameProgress = await gameProgressModel
        .find({ userId: { $in: participantIds } })
        .lean()
        .exec();

      // 3. Create maps
      const usersMap = new Map(allUsers.map(u => [this.normalizeId(u._id) || '', u]));
      const progressMap = new Map(
        allGameProgress.map(gp => [this.normalizeId(gp.userId) || '', gp])
      );

      // 4. Process participants using maps (no queries)
      participantIds.forEach((normalizedId) => {
        const player = usersMap.get(normalizedId);
        const gameProgress = progressMap.get(normalizedId);

        try {
          const playerTyped = player as unknown as UserLean;
          const coins =
            player &&
            typeof playerTyped?.coins === 'number' &&
            Number.isFinite(playerTyped.coins)
              ? playerTyped.coins
              : 0;
          playerCoins[normalizedId] = coins;

          // Get user name and profile image
          const userName = playerTyped?.name || playerTyped?.username || '';
          const userProfileImage = playerTyped?.profileImage || null;
          // Check if this player is the host (first participant)
          const isHost = normalizedId === hostId;
          playerInfo[normalizedId] = {
            name: userName,
            profileImage: userProfileImage,
            isHost: isHost,
          };

          // Get GameProgress for points, level, and winner rate
          if (gameProgress) {
            // Points
            const points = typeof gameProgress.points === 'number' && Number.isFinite(gameProgress.points)
              ? gameProgress.points
              : 0;
            playerPoints[normalizedId] = points;

            // Level name with name
            const level = typeof gameProgress.level === 'number' && Number.isFinite(gameProgress.level)
              ? gameProgress.level
              : 1;
            const levelName = this.contentService.getLevelNameForLevel(level);
            playerLevel[normalizedId] = {
              levelName: levelName,
              name: userName,
            };

            // Winner rate: totalWins / totalGamesPlayed
            const totalWins = typeof gameProgress.totalWins === 'number' && Number.isFinite(gameProgress.totalWins)
              ? gameProgress.totalWins
              : 0;
            const totalGamesPlayed = typeof gameProgress.totalGamesPlayed === 'number' && Number.isFinite(gameProgress.totalGamesPlayed)
              ? gameProgress.totalGamesPlayed
              : 0;
            const calculatedWinnerRate = totalGamesPlayed > 0 ? (totalWins / totalGamesPlayed) : 0;
            // Round to 2 decimal places
            winnerRate[normalizedId] = Math.round(calculatedWinnerRate * 100) / 100;
          } else {
            // Default values if GameProgress not found
            playerPoints[normalizedId] = 0;
            playerLevel[normalizedId] = {
              levelName: 'Awakened', // Default level name for level 1
              name: userName,
            };
            winnerRate[normalizedId] = 0;
          }
        } catch (error) {
          console.warn('[restartGame] Failed to fetch player info:', {
            playerId: normalizedId,
            error: error.message,
          });
          playerCoins[normalizedId] = 0;
          // Check if this player is the host (first participant)
          const isHost = normalizedId === hostId;
          playerInfo[normalizedId] = {
            name: '',
            profileImage: null,
            isHost: isHost,
          };
          playerPoints[normalizedId] = 0;
          playerLevel[normalizedId] = {
            levelName: 'Awakened', // Default level name for level 1
            name: '',
          };
          winnerRate[normalizedId] = 0;
        }
      });
      console.log('[restartGame] Player coins and info collected:', {
        playerCoins,
        playerInfo,
        playerPoints,
        playerLevel,
        winnerRate,
      });

      // Ensure all players (participants + connected eliminated players) are joined to the room
      finalPlayersList.forEach((playerId) => {
        const playerSocket = this.userSockets.get(playerId);
        if (playerSocket) {
          playerSocket.join(roomId);
          console.log('[restartGame] Joined player to room:', {
            playerId,
            roomId,
            socketId: playerSocket.id,
          });
        } else {
          console.warn('[restartGame] Player socket not found:', {
            playerId,
            availableSockets: Array.from(this.userSockets.keys()),
          });
        }
      });

      // Notify all players that game is created (same as createGame)
      // NOTE: We send full game metadata here (like single-player gameStart),
      // and DO NOT send a separate gameStart payload for restartGame.
      // This makes restartGame work exactly like createGame.
      const gameCreatedPayload = {
        success: true,
        gameId: result.gameId,
        roomId: roomId,
        deckId: result.deckId,
        deckName: result.deckName,
        topicId: newTopicId,
        subTopicId: newNormalizedSubTopicId,
        totalQuestions: questions.length,
        lives: hostLives,
        timePerQuestion: QUESTION_TIME_SECONDS,
        subTopicIndex: newSubTopicIndex,
        totalSubTopics: newTotalSubTopics,
        round: newRound, // Include incremented round for restarted game
        // coins per player, e.g. { "userId1": 10, "userId2": 5 }
        coins: playerCoins,
        // player info per player, e.g. { "userId1": { name: "John", profileImage: "url" }, "userId2": { name: "Jane", profileImage: "url" } }
        playerInfo: playerInfo,
        // player points per player, e.g. { "userId1": 100, "userId2": 50 }
        playerPoints: playerPoints,
        // player level per player with name, e.g. { "userId1": { levelName: "Catalysts", name: "John" }, "userId2": { levelName: "Pathfinders", name: "Jane" } }
        playerLevel: playerLevel,
        // winner rate per player (totalWins / totalGamesPlayed), e.g. { "userId1": 0.75, "userId2": 0.50 }
        winnerRate: winnerRate,
        questions,
        mode,
        topicType: topicType || 'random',
        players: finalPlayersList, // Use final players list (includes eliminated but not left players)
        gameMode: gameMode || undefined,
        member: member || undefined,
      };
      console.log('[restartGame] Emitting gameCreated event to room:', {
        roomId: roomId,
        gameId: result.gameId,
        finalPlayersList,
        payload: {
          ...gameCreatedPayload,
          questions: `[${questions.length} questions]`, // Don't log full questions array
        },
      });
      // Emit to room, not globally - ensures only users in the room receive it
      // Use same event name as createGame so client can listen to same event
      this.server.to(roomId).emit('gameCreated', gameCreatedPayload);
      console.log('[restartGame] Game restarted successfully:', {
        userId,
        gameId: result.gameId,
        roomId: roomId,
        finalPlayers: finalPlayersList,
        includedEliminated: allEliminatedPlayers.filter(p => finalPlayersList.includes(p)),
      });
    } catch (error) {
      console.error('[restartGame] Error occurred:', {
        userId,
        roomId,
        error: error.message,
        stack: error.stack,
        body,
      });
      client.emit('errorMessage', {
        message: error?.message || 'Failed to restart game',
      });
    }
  }

  // -------------------------------------------------------------
  // START MULTIPLAYER GAME (OPTIONAL - createGame now auto-starts)
  // This method is kept for backward compatibility
  // Host can call this if they want to start a game later after creation
  // -------------------------------------------------------------
  @SubscribeMessage('startGame')
  async startMultiplayerGame(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { gameId: string },
  ) {
    const userId = client.data.userId as string;
    console.log('[startGame] Event received:', {
      userId,
      body,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[startGame] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    // Check if user is online
    const isOnline = await this.checkUserIsOnline(userId);
    console.log('[startGame] User online status:', { userId, isOnline });
    if (!isOnline) {
      console.log('[startGame] Error: User is not online');
      return client.emit('errorMessage', {
        message: 'You must be online to start games. Please set your status to online.',
      });
    }

    const { gameId } = body;

    if (!gameId) {
      console.log('[startGame] Error: gameId is required');
      return client.emit('errorMessage', { message: 'gameId is required' });
    }

    console.log('[startGame] Starting multiplayer game:', { userId, gameId });

    try {
      // Get game from database
      const gameModel = this.contentService.getGameModel();
      const game = await gameModel.findOne({ gameId }).lean().exec();

      if (!game) {
        return client.emit('errorMessage', { message: 'Game not found' });
      }

      if (game.gameStarted) {
        return client.emit('errorMessage', {
          message: 'Game already started',
        });
      }

      // Check if user is in room
      const room = this.contentService.getRoomByUserId(userId);
      if (!room || room.roomId !== gameId) {
        return client.emit('errorMessage', {
          message: 'You are not in this game room',
        });
      }

      // Generate questions for the subtopic
      const { subTopic: mpSubTopic, topic: mpTopic } =
        await this.contentService.getSubTopicAndTopic(game.subTopicId);

      // Calculate topicId, subTopicIndex and totalSubTopics (same as single-player)
      const mpTopicId = this.normalizeId(mpTopic._id) as string;
      const mpOrderedSubTopicIds = (mpTopic.subTopics ?? [])
        .map((id) => this.normalizeId(id))
        .filter((id): id is string => !!id);
      const mpNormalizedSubTopicId = this.normalizeId(
        game.subTopicId,
      ) as string;
      const mpSubTopicIndex =
        mpOrderedSubTopicIds.findIndex((id) => id === mpNormalizedSubTopicId) +
        1;
      const mpTotalSubTopics = mpOrderedSubTopicIds.length;

      const aiService = this.contentService.getAiService();
      const questions = await aiService.generateMCQQuestions(
        mpSubTopic.title,
        mpSubTopic.description,
        game.difficulty || 'medium',
      );

      if (!Array.isArray(questions) || questions.length === 0) {
        return client.emit('errorMessage', {
          message: 'No questions available for this topic',
        });
      }

      // Update game with questions
      // Set round to 1 if it doesn't exist (for backward compatibility)
      const gameTyped = game as unknown as GameLean;
      const existingRound = typeof gameTyped.round === 'number' ? gameTyped.round : 1;
      await gameModel.updateOne(
        { gameId },
        {
          $set: {
            questions,
            gameStarted: true,
            startTime: new Date(),
            currentQuestion: 0,
            round: existingRound, // Keep existing round or set to 1 if doesn't exist
          },
        },
      );

      // Create multiplayer game state
      const multiplayerState: MultiplayerGameState = {
        gameId,
        roomId: room.roomId,
        players: game.players,
        subTopicId: mpNormalizedSubTopicId,
        questions,
        currentIndex: 0,
        playerAnswers: new Map(),
        playerScores: new Map(),
        playerWrongAnswers: new Map(),
        eliminatedPlayers: new Set(),
        gameMode: (game.metadata as unknown as GameMetadata)?.gameMode as 'Regular' | 'Knockout' | undefined,
        startedAt: new Date(),
        isCompleted: false,
      };

      // Initialize scores and wrong answers for all players
      game.players.forEach((playerId) => {
        multiplayerState.playerScores.set(playerId, 0);
        multiplayerState.playerAnswers.set(playerId, []);
        multiplayerState.playerWrongAnswers.set(playerId, 0);
      });

      this.multiplayerGames.set(room.roomId, multiplayerState);

      // Send game start to all players in room, mirroring single-player payload shape
      this.server.to(room.roomId).emit('gameStart', {
        gameId,
        roomId: room.roomId,
        totalQuestions: questions.length,
        timePerQuestion: QUESTION_TIME_SECONDS,
        topicId: mpTopicId,
        subTopicId: mpNormalizedSubTopicId,
        subTopicIndex: mpSubTopicIndex,
        totalSubTopics: mpTotalSubTopics,
        // No deck info here because this path starts from existing game
        questions,
        players: game.players,
      });
      this.server.to(room.roomId).emit('startGame', {
        gameId,
        roomId: room.roomId,
        totalQuestions: questions.length,
        timePerQuestion: QUESTION_TIME_SECONDS,
        topicId: mpTopicId,
        subTopicId: mpNormalizedSubTopicId,
        subTopicIndex: mpSubTopicIndex,
        totalSubTopics: mpTotalSubTopics,
        // No deck info here because this path starts from existing game
        questions,
        players: game.players,
      });
      console.log('[startGame] Game started successfully:', {
        userId,
        gameId,
        roomId: room.roomId,
        totalQuestions: questions.length,
      });

    } catch (error) {
      console.error('[startGame] Error occurred:', {
        userId,
        gameId,
        error: error.message,
        stack: error.stack,
        body,
      });
      client.emit('errorMessage', {
        message: error?.message || 'Failed to start game',
      });
    }
  }

  // -------------------------------------------------------------
  // SEND NEXT QUESTION
  // -------------------------------------------------------------
  private sendNextQuestion(gameState: GameState) {
    const { socket, questions, currentIndex } = gameState;

    if (currentIndex >= questions.length) {
      return this.endGame(gameState);
    }

    const q = questions[currentIndex];

    socket.emit('question', {
      index: currentIndex,
      total: questions.length,
      question: {
        text: q.question,
        options: q.options ?? [],
        id: q.id,
        hint: q.hint,
        correctAnswer: q.correctAnswer,
      },
      lives: gameState.lives,
      time: QUESTION_TIME_SECONDS,
    });

    gameState.questionStartAt = new Date();

    if (gameState.timer) clearTimeout(gameState.timer);

    gameState.timer = setTimeout(() => {
      this.handleWrongAnswer(gameState, null, socket);
    }, QUESTION_TIMEOUT_MS);
  }

  // -------------------------------------------------------------
  // SEND NEXT MULTIPLAYER QUESTION
  // -------------------------------------------------------------
  private sendNextMultiplayerQuestion(
    gameState: MultiplayerGameState,
  ) {
    const { roomId, questions, currentIndex } = gameState;

    if (currentIndex >= questions.length) {
      return this.endMultiplayerGame(gameState);
    }

    const q = questions[currentIndex];

    // Get list of eliminated players for Knockout mode
    const eliminatedPlayersList = gameState.gameMode === 'Knockout'
      ? Array.from(gameState.eliminatedPlayers)
      : [];

    // Send question to all players in room
    this.server.to(roomId).emit('question', {
      index: currentIndex,
      total: questions.length,
      question: {
        text: q.question,
        options: q.options ?? [],
        id: q.id,
        hint: q.hint,
        correctAnswer: q.correctAnswer,
      },
      time: QUESTION_TIME_SECONDS,
      eliminatedPlayers: eliminatedPlayersList, // Include eliminated players list
      gameMode: gameState.gameMode, // Include game mode
    });

    gameState.questionStartAt = new Date();

    // Clear existing timer
    if (gameState.timer) clearTimeout(gameState.timer);

    // Set timer for question timeout
    gameState.timer = setTimeout(() => {
      // Handle timeout - mark as wrong for players who didn't answer
      this.handleMultiplayerQuestionTimeout(gameState);
    }, QUESTION_TIMEOUT_MS);
  }

  // -------------------------------------------------------------
  // ANSWER HANDLER
  // -------------------------------------------------------------
  @SubscribeMessage('submitanswer')
  async answerQuestion(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { index: number; answer: string | null; gameId?: string },
  ) {
    const userId = client.data.userId;
    console.log('[submitanswer] Event received:', {
      userId,
      body,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[submitanswer] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    // Check if user is blocked
    const { isBlocked } = await this.checkUserIsBlocked(userId);
    if (isBlocked) {
      console.log('[submitanswer] Error: User account is blocked:', { userId });
      return client.emit('errorMessage', { message: 'Your account is blocked' });
    }

    // Check if user is online
    const isOnline = await this.checkUserIsOnline(userId);
    console.log('[submitanswer] User online status:', { userId, isOnline });
    if (!isOnline) {
      console.log('[submitanswer] Error: User is not online');
      return client.emit('errorMessage', {
        message: 'You must be online to submit answers. Please set your status to online.',
      });
    }

    const { answer, index, gameId } = body;
    console.log('[submitanswer] Processing answer:', {
      userId,
      index,
      hasAnswer: !!answer,
      gameId,
    });

    // Check if it's a multiplayer game
    if (gameId) {
      console.log('[submitanswer] Checking for multiplayer game:', { gameId });
      const room = this.contentService.getRoomByRoomId(gameId);
      if (room) {
        const multiplayerState = this.multiplayerGames.get(room.roomId);
        if (multiplayerState) {
          console.log('[submitanswer] Handling multiplayer answer:', {
            userId,
            gameId,
            roomId: room.roomId,
          });
          return this.handleMultiplayerAnswer(
            client,
            multiplayerState,
            userId,
            index,
            answer,
          );
        }
      }
    }

    // Single player game
    console.log('[submitanswer] Handling single-player answer:', { userId });
    const gameState = this.activeGames.get(userId);
    if (!gameState) {
      console.log('[submitanswer] Error: No active game found:', { userId });
      return client.emit('errorMessage', { message: 'No active game' });
    }

    const currentIndex = gameState.currentIndex;

    if (Number(index) !== Number(currentIndex)) {
      console.log('[submitanswer] Error: Invalid question index:', {
        userId,
        providedIndex: index,
        currentIndex,
      });
      return client.emit('errorMessage', {
        message: 'Invalid question index',
      });
    }

    const currentQ = gameState.questions[currentIndex];

    const normalizedAnswer =
      typeof answer === 'string' ? answer.trim().toLowerCase() : null;
    const isCorrect =
      normalizedAnswer !== null &&
      currentQ.correctAnswer.trim().toLowerCase() === normalizedAnswer;
    gameState.isCorrect = isCorrect;
    console.log('[submitanswer] Answer evaluated:', {
      userId,
      index: currentIndex,
      isCorrect,
      userAnswer: answer ?? null,
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

    // 🔥🔥🔥 Update player progress immediately
    await this.contentService.updateProgressAfterQuestion(
      userId,
      isCorrect,
    );

    if (isCorrect) {
      gameState.score++;
      console.log('[submitanswer] Correct answer, updating score:', {
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
        console.log('[submitanswer] All questions completed, ending game:', {
          userId,
          finalScore: gameState.score,
        });
        return this.endGame(gameState);
      }
    } else {
      // WRONG ANSWER
      console.log('[submitanswer] Wrong answer, handling:', {
        userId,
        currentIndex,
      });
      await this.handleWrongAnswer(gameState, answer, client);
    }
  }

  // -------------------------------------------------------------
  // HANDLE MULTIPLAYER ANSWER
  // -------------------------------------------------------------
  private async handleMultiplayerAnswer(
    client: Socket,
    gameState: MultiplayerGameState,
    userId: string,
    index: number,
    answer: string | null,
  ) {
    const normalizedUserId = this.normalizeId(userId);
    console.log('[handleMultiplayerAnswer] Processing answer:', {
      userId: normalizedUserId,
      gameId: gameState.gameId,
      roomId: gameState.roomId,
      index,
      hasAnswer: !!answer,
    });

    if (!normalizedUserId) {
      console.log('[handleMultiplayerAnswer] Error: Invalid user:', { userId });
      return client.emit('errorMessage', { message: 'Invalid user' });
    }

    if (!gameState.players.includes(normalizedUserId)) {
      console.log('[handleMultiplayerAnswer] Error: User not a player:', {
        userId: normalizedUserId,
        players: gameState.players,
      });
      return client.emit('errorMessage', {
        message: 'You are not a player in this game',
      });
    }

    // Check if player is eliminated (Knockout mode)
    if (gameState.eliminatedPlayers.has(normalizedUserId)) {
      console.log('[handleMultiplayerAnswer] Error: Player eliminated:', {
        userId: normalizedUserId,
      });
      return client.emit('errorMessage', {
        message: 'You have been eliminated and cannot answer questions',
      });
    }

    const currentIndex = gameState.currentIndex;

    if (Number(index) !== Number(currentIndex)) {
      console.log('[handleMultiplayerAnswer] Error: Invalid question index:', {
        userId: normalizedUserId,
        providedIndex: index,
        currentIndex,
      });
      return client.emit('errorMessage', {
        message: 'Invalid question index',
      });
    }

    // Check if user already answered this question
    const userAnswers = gameState.playerAnswers.get(normalizedUserId) || [];
    const alreadyAnswered = userAnswers.some((a) => a.index === currentIndex);
    if (alreadyAnswered) {
      console.log('[handleMultiplayerAnswer] Error: Already answered:', {
        userId: normalizedUserId,
        currentIndex,
      });
      return client.emit('errorMessage', {
        message: 'You have already answered this question',
      });
    }

    const currentQ = gameState.questions[currentIndex];
    const normalizedAnswer =
      typeof answer === 'string' ? answer.trim().toLowerCase() : null;
    const isCorrect =
      normalizedAnswer !== null &&
      currentQ.correctAnswer.trim().toLowerCase() === normalizedAnswer;
    console.log('[handleMultiplayerAnswer] Answer evaluated:', {
      userId: normalizedUserId,
      index: currentIndex,
      isCorrect,
      userAnswer: answer ?? null,
      correctAnswer: currentQ.correctAnswer,
    });

    // Record answer
    const answerRecord: AnswerRecord = {
      index: currentIndex,
      question: currentQ.question,
      userAnswer: answer,
      correctAnswer: currentQ.correctAnswer,
      isCorrect,
      timestamp: new Date(),
    };

    userAnswers.push(answerRecord);
    gameState.playerAnswers.set(normalizedUserId, userAnswers);

    // Update score
    if (isCorrect) {
      const currentScore = gameState.playerScores.get(normalizedUserId) || 0;
      gameState.playerScores.set(normalizedUserId, currentScore + 1);
    } else {
      // Track wrong answers for Knockout mode
      if (gameState.gameMode === 'Knockout') {
        const currentWrongAnswers = gameState.playerWrongAnswers.get(normalizedUserId) || 0;
        const newWrongAnswers = currentWrongAnswers + 1;
        gameState.playerWrongAnswers.set(normalizedUserId, newWrongAnswers);

        // Check if player should be eliminated (3 wrong answers)
        if (newWrongAnswers >= 3) {
          gameState.eliminatedPlayers.add(normalizedUserId);
          // Persist eliminated player in game document
          try {
            const gameModel = this.contentService.getGameModel();
            await gameModel
              .updateOne(
                { gameId: gameState.gameId },
                { $addToSet: { eliminatedPlayers: normalizedUserId } },
              )
              .exec();
          } catch (dbErr) {
            console.error('[handleMultiplayerAnswer] Failed to persist eliminated player to DB', {
              userId: normalizedUserId,
              gameId: gameState.gameId,
              error: dbErr?.message || dbErr,
            });
          }

          // Get all eliminated players list
          const allEliminatedPlayers = Array.from(gameState.eliminatedPlayers);

          // Notify all players in room about elimination (including eliminated player)
          this.server.to(gameState.roomId).emit('playerEliminated', {
            eliminatedUserId: normalizedUserId,
            gameId: gameState.gameId,
            roomId: gameState.roomId,
            wrongAnswers: newWrongAnswers,
            allEliminatedPlayers: allEliminatedPlayers, // List of all eliminated players
            activePlayers: gameState.players.filter(
              (p) => !gameState.eliminatedPlayers.has(p)
            ), // List of active players
          });

          // Notify the eliminated player specifically (only include their id)
          client.emit('youAreEliminated', {
            message: 'You have been eliminated after 3 wrong answers',
            wrongAnswers: newWrongAnswers,
            eliminatedPlayers: [normalizedUserId], // Only the eliminated player's id
          });

          // DO NOT send gameOver immediately - wait for game to end
          // DO NOT remove eliminated player from game state - keep them to receive final gameOver
          // Only update DB to mark them as eliminated (already done above)

          // Check if game should end (only one player remaining)
          const activePlayers = gameState.players.filter(
            (p) => !gameState.eliminatedPlayers.has(p)
          );
          if (activePlayers.length <= 1) {
            // End game early
            setTimeout(() => {
              this.endMultiplayerGame(gameState);
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

    // Send answer result to the player
    client.emit('answerResult', {
      correct: isCorrect,
      score: gameState.playerScores.get(normalizedUserId) || 0,
      questionIndex: currentIndex,
      correctAnswer: currentQ.correctAnswer,
      wrongAnswers: gameState.playerWrongAnswers.get(normalizedUserId) || 0,
      isEliminated: gameState.eliminatedPlayers.has(normalizedUserId),
    });

    // Check if all active (non-eliminated) players have answered
    const activePlayers = gameState.players.filter(
      (p) => !gameState.eliminatedPlayers.has(p)
    );
    const allAnswered = activePlayers.every((playerId) => {
      const answers = gameState.playerAnswers.get(playerId) || [];
      return answers.some((a) => a.index === currentIndex);
    });

    // Only broadcast all user answers when ALL participants have answered
    if (allAnswered) {
      // Collect all answers for current question from all players
      const allUserAnswers = gameState.players
        .map((playerId) => {
          const playerAnswers = gameState.playerAnswers.get(playerId) || [];
          const currentQuestionAnswer = playerAnswers.find((a) => a.index === currentIndex);
          if (currentQuestionAnswer) {
            return {
              userId: playerId,
              userAnswer: currentQuestionAnswer.userAnswer,
              isCorrect: currentQuestionAnswer.isCorrect,
              score: gameState.playerScores.get(playerId) || 0,
            };
          }
          return null;
        })
        .filter((answer): answer is {
          userId: string;
          userAnswer: string | null;
          isCorrect: boolean;
          score: number;
        } => answer !== null);

      // Broadcast all user answers to all participants in the room
      this.server.to(gameState.roomId).emit('alluseranswerresult', {
        gameId: gameState.gameId,
        roomId: gameState.roomId,
        questionIndex: currentIndex,
        correctAnswer: currentQ.correctAnswer,
        allAnswers: allUserAnswers,
      });
      // Clear timer
      if (gameState.timer) {
        clearTimeout(gameState.timer);
        gameState.timer = null;
      }

      // Wait a bit before moving to next question index
      // Questions are already sent upfront in gameStart, so we don't emit per-question events here
      setTimeout(() => {
        gameState.currentIndex++;
        if (gameState.currentIndex >= gameState.questions.length) {
          // All questions completed, end game
          this.endMultiplayerGame(gameState);
        }
      }, 1000);
    }
  }

  // -------------------------------------------------------------
  // HANDLE MULTIPLAYER QUESTION TIMEOUT
  // -------------------------------------------------------------
  private async handleMultiplayerQuestionTimeout(
    gameState: MultiplayerGameState,
  ) {
    const { currentIndex, questions } = gameState;
    const currentQ = questions[currentIndex];

    // Mark unanswered active (non-eliminated) players as wrong
    const activePlayers = gameState.players.filter(
      (p) => !gameState.eliminatedPlayers.has(p)
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
          const currentWrongAnswers =
            gameState.playerWrongAnswers.get(playerId) || 0;
          const newWrongAnswers = currentWrongAnswers + 1;
          gameState.playerWrongAnswers.set(playerId, newWrongAnswers);

          // Check if player should be eliminated (3 wrong answers)
          if (newWrongAnswers >= 3) {
            gameState.eliminatedPlayers.add(playerId);
            // Persist eliminated player in game document
            try {
              const gameModel = this.contentService.getGameModel();
              await gameModel
                .updateOne(
                  { gameId: gameState.gameId },
                  { $addToSet: { eliminatedPlayers: playerId } },
                )
                .exec();
            } catch (dbErr) {
              console.error('[handleMultiplayerQuestionTimeout] Failed to persist eliminated player to DB', {
                userId: playerId,
                gameId: gameState.gameId,
                error: dbErr?.message || dbErr,
              });
            }

            // Get all eliminated players list
            const allEliminatedPlayers = Array.from(
              gameState.eliminatedPlayers,
            );

            // Notify all players in room about elimination (including eliminated player)
            this.server.to(gameState.roomId).emit('playerEliminated', {
              eliminatedUserId: playerId,
              gameId: gameState.gameId,
              roomId: gameState.roomId,
              wrongAnswers: newWrongAnswers,
              allEliminatedPlayers: allEliminatedPlayers, // List of all eliminated players
              activePlayers: gameState.players.filter(
                (p) => !gameState.eliminatedPlayers.has(p),
              ), // List of active players
            });

            // Notify the eliminated player specifically (only include their id)
            const playerSocket = this.userSockets.get(playerId);
            if (playerSocket) {
              playerSocket.emit('youAreEliminated', {
                message: 'You have been eliminated after 3 wrong answers',
                wrongAnswers: newWrongAnswers,
                eliminatedPlayers: [playerId], // Only the eliminated player's id
              });
            }

            // DO NOT remove eliminated player from game state - keep them to receive final gameOver
            // Only update DB to mark them as eliminated (already done above)
          }
        }

        // Send timeout result to player
        const playerSocket = this.userSockets.get(playerId);
        if (playerSocket) {
          playerSocket.emit('answerResult', {
            correct: false,
            score: gameState.playerScores.get(playerId) || 0,
            questionIndex: currentIndex,
            correctAnswer: currentQ.correctAnswer,
            timeout: true,
            wrongAnswers:
              gameState.playerWrongAnswers.get(playerId) || 0,
            isEliminated: gameState.eliminatedPlayers.has(playerId),
          });
        }
      }
    }

    // Collect all answers for current question from all players (including timeout answers)
    const allUserAnswers = gameState.players
      .map((playerId) => {
        const playerAnswers = gameState.playerAnswers.get(playerId) || [];
        const currentQuestionAnswer = playerAnswers.find((a) => a.index === currentIndex);
        if (currentQuestionAnswer) {
          return {
            userId: playerId,
            userAnswer: currentQuestionAnswer.userAnswer,
            isCorrect: currentQuestionAnswer.isCorrect,
            score: gameState.playerScores.get(playerId) || 0,
          };
        }
        return null;
      })
      .filter((answer): answer is {
        userId: string;
        userAnswer: string | null;
        isCorrect: boolean;
        score: number;
      } => answer !== null);

    // Broadcast all user answers to all participants in the room
    this.server.to(gameState.roomId).emit('alluseranswerresult', {
      gameId: gameState.gameId,
      roomId: gameState.roomId,
      questionIndex: currentIndex,
      correctAnswer: currentQ.correctAnswer,
      allAnswers: allUserAnswers,
    });

    // Check if game should end (only one player remaining)
    const remainingActivePlayers = gameState.players.filter(
      (p) => !gameState.eliminatedPlayers.has(p)
    );
    if (remainingActivePlayers.length <= 1) {
      // End game early
      setTimeout(() => {
        this.endMultiplayerGame(gameState);
      }, 2000);
      return;
    }

    // Move to next question
    setTimeout(() => {
      gameState.currentIndex++;
      this.sendNextMultiplayerQuestion(gameState);
    }, 1000);
  }

  // -------------------------------------------------------------
  // WRONG ANSWER HANDLER
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
        userAnswer,
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

    gameState.lives = updatedUser.lives;
    const targetSocket = client ?? socket;
    targetSocket.emit('answerResult', {
      correct: false,
      livesLeft: gameState.lives,
      correctAnswer: currentQ.correctAnswer,
      questionIndex: currentIndex,
      userAnswer: userAnswer ?? null,
    });

    if (gameState.lives <= 0) {
      return this.endGame(gameState);
    }

    gameState.currentIndex++;
    if (gameState.currentIndex >= gameState.questions.length) {
      return this.endGame(gameState);
    }
  }

  // -------------------------------------------------------------
  // REMOVE PLAYER FROM ACTIVE GAME (BRAWL MODE)
  // Removes a player from an active BRAWL game and continues with remaining players
  // -------------------------------------------------------------
  private async removePlayerFromGame(
    gameState: MultiplayerGameState,
    leavingUserId: string,
    roomId: string,
  ) {
    const normalizedLeavingUserId = this.normalizeId(leavingUserId);
    if (!normalizedLeavingUserId) {
      return;
    }

    // Remove player from game state
    gameState.players = gameState.players.filter(
      (p) => this.normalizeId(p) !== normalizedLeavingUserId
    );

    // Remove player's answers and scores
    gameState.playerAnswers.delete(normalizedLeavingUserId);
    gameState.playerScores.delete(normalizedLeavingUserId);

    // ✅ OPTIMIZATION: Combine both updates into single database call
    // This reduces database round trips from 2 to 1
    const gameModel = this.contentService.getGameModel();
    await gameModel.updateOne(
      { gameId: gameState.gameId },
      {
        $pull: {
          players: normalizedLeavingUserId,
          acceptedPlayers: normalizedLeavingUserId,
        },
      },
    );

    // Remove user from room but keep room active for remaining players
    await this.contentService.removeUserFromRoomParticipants(roomId, normalizedLeavingUserId);
  }

  // -------------------------------------------------------------
  // END MULTIPLAYER GAME — WIN/LOSS/DRAW LOGIC
  // -------------------------------------------------------------
  private async endMultiplayerGame(
    gameState: MultiplayerGameState,
    skipPointsAndCoins: boolean = false,
    leavingUserId?: string,
  ) {
    console.log('[endMultiplayerGame] Ending multiplayer game:', {
      gameId: gameState.gameId,
      roomId: gameState.roomId,
      players: gameState.players,
      skipPointsAndCoins,
      leavingUserId,
      currentIndex: gameState.currentIndex,
      totalQuestions: gameState.questions.length,
    });

    if (gameState.timer) clearTimeout(gameState.timer);

    const { gameId, players, questions, playerAnswers, playerScores } =
      gameState;

    // Calculate correct answers and accuracy for each player
    const playerCorrectCounts: Map<string, number> = new Map();
    const playerAccuracies: Map<string, number> = new Map();

    players.forEach((playerId) => {
      const answers = playerAnswers.get(playerId) || [];
      const correctCount = answers.filter((a) => a.isCorrect).length;
      playerCorrectCounts.set(playerId, correctCount);

      // Calculate accuracy: (correct answers / total questions) * 100
      const totalQuestions = questions.length;
      const accuracy = totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0;
      const accuracyRounded = Math.round(accuracy * 100) / 100;
      playerAccuracies.set(playerId, accuracyRounded);
    });

    // Determine winner/loser/draw for each player
    const scores = Array.from(playerCorrectCounts.entries());
    scores.sort((a, b) => b[1] - a[1]); // Sort by score descending

    // Find highest score and determine winners
    const highestScore = scores.length > 0 ? scores[0][1] : 0;
    const winners = scores.filter(([_, score]) => score === highestScore).map(([userId]) => userId);
    const isDraw = winners.length > 1;
    console.log('[endMultiplayerGame] Game results calculated:', {
      gameId,
      scores: Array.from(playerCorrectCounts.entries()),
      winners,
      isDraw,
      highestScore,
    });

    // Track points awarded to each player
    const playerPoints: Map<string, number> = new Map();
    const playerResults: Map<string, 'win' | 'loss' | 'draw' | 'eliminated'> = new Map();

    // Determine result for each player (without awarding points yet)
    for (const playerId of players) {
      const playerScore = playerCorrectCounts.get(playerId) || 0;

      // Check if player is eliminated (Knockout mode)
      if (gameState.eliminatedPlayers.has(playerId)) {
        // Eliminated player
        playerResults.set(playerId, 'eliminated');
        playerPoints.set(playerId, 0);
        continue; // Skip win/loss/draw logic for eliminated players
      }

      if (skipPointsAndCoins && leavingUserId) {
        // If user left, mark leaving user as loser
        const normalizedLeavingUserId = this.normalizeId(leavingUserId);
        const normalizedPlayerId = this.normalizeId(playerId);

        if (normalizedPlayerId === normalizedLeavingUserId) {
          playerResults.set(playerId, 'loss');
        } else {
          playerResults.set(playerId, 'win');
        }
        playerPoints.set(playerId, 0);
      } else {
        // Normal game end logic
        if (isDraw && winners.includes(playerId)) {
          // Multiple players tied for highest score = draw
          playerResults.set(playerId, 'draw');
          playerPoints.set(playerId, skipPointsAndCoins ? 0 : 5);
        } else if (winners.includes(playerId)) {
          // Single winner
          playerResults.set(playerId, 'win');
          playerPoints.set(playerId, skipPointsAndCoins ? 0 : 10);
        } else {
          // Loser
          playerResults.set(playerId, 'loss');
          playerPoints.set(playerId, 0);
        }
      }
    }

    // ✅ OPTIMIZATION: Batch all award operations in parallel instead of sequential loop
    // This fixes the N+1 query problem - all database calls happen in parallel
    if (!skipPointsAndCoins) {
      const awardPromises = players.map(async (playerId) => {
        const points = playerPoints.get(playerId) || 0;
        const result = playerResults.get(playerId);
        
        // Determine coins based on result
        let coins = 0;
        if (result === 'win') {
          coins = 5;
        } else if (result === 'draw') {
          coins = 5;
        } else {
          coins = 0;
        }
        
        return this.contentService.awardPointsAndCoins(playerId, points, coins);
      });
      
      await Promise.all(awardPromises);
    }

    // Create result object for backward compatibility (DUEL mode)
    const player1Id = players[0];
    const player2Id = players[1];
    const player1Result = playerResults.get(player1Id) || 'draw';
    const player2Result = playerResults.get(player2Id) || 'draw';
    const player1Score = playerCorrectCounts.get(player1Id) || 0;
    const player2Score = playerCorrectCounts.get(player2Id) || 0;

    const result: {
      player1: { userId: string; result: 'win' | 'loss' | 'draw' | 'eliminated'; score: number };
      player2: { userId: string; result: 'win' | 'loss' | 'draw' | 'eliminated'; score: number };
    } = {
      player1: { userId: player1Id, result: player1Result, score: player1Score },
      player2: { userId: player2Id, result: player2Result, score: player2Score },
    };

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
    const accuracyObj: Record<string, number> = {};
    players.forEach((playerId) => {
      scoresObj[playerId] = playerScores.get(playerId) || 0;
      accuracyObj[playerId] = playerAccuracies.get(playerId) || 0;
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

    // Update total games played for both players (skip if points/coins are skipped)
    if (!skipPointsAndCoins) {
      await Promise.all(
        players.map((playerId) =>
          this.contentService.incrementTotalGamesPlayed(playerId),
        ),
      );

      // Update daily streak for all players (Type 1: 7-day icons, Type 2: current streak)
      const streakUpdates = await Promise.all(
        players.map((playerId) =>
          this.contentService.updateDailyStreak(playerId),
        ),
      );

      // Get daily streak info for all players
      const playerDailyStreaks: Record<string, any> = {};
      
      // Collect players that need fallback query
      const playersNeedingFallback: string[] = [];
      
      for (let i = 0; i < players.length; i++) {
        const playerId = players[i];
        const streakUpdate = streakUpdates[i];
        if (streakUpdate) {
          playerDailyStreaks[playerId] = {
            currentDailyStreak: streakUpdate.currentDailyStreak || 0,
            longestDailyStreak: streakUpdate.longestDailyStreak || 0,
            dailyStreakIcons: streakUpdate.dailyStreakIcons || [],
          };
        } else {
          playersNeedingFallback.push(playerId);
        }
      }
      
      // Batch query daily streaks for players that need fallback
      if (playersNeedingFallback.length > 0) {
        const fallbackStreaks = await Promise.all(
          playersNeedingFallback.map((playerId) =>
            this.contentService.getDailyStreak(playerId),
          ),
        );
        
        // Map fallback results back to players
        for (let j = 0; j < playersNeedingFallback.length; j++) {
          const playerId = playersNeedingFallback[j];
          playerDailyStreaks[playerId] = fallbackStreaks[j];
        }
      }

      // Batch fetch all users
      const playerIds = players
        .map(p => this.normalizeId(p))
        .filter((id): id is string => !!id);

      const userModel = this.contentService.getUserModel();

      // Fetch all users in one query
      const allUsers = await userModel
        .find({ _id: { $in: playerIds } })
        .lean()
        .exec();

      // Create map
      const usersMap = new Map(allUsers.map(u => [this.normalizeId(u._id) || '', u]));

      // Send personalized gameOver to each player
      await Promise.all(
        players.map(async (playerId) => {
          const playerSocket = this.userSockets.get(playerId);
          if (playerSocket) {
            const playerResult = playerResults.get(playerId) || 'draw';
            const playerScore = playerCorrectCounts.get(playerId) || 0;
            const playerPoint = playerPoints.get(playerId) || 0;
            const playerAccuracy = playerAccuracies.get(playerId) || 0;
            const playerAnswerRecords = playerAnswers.get(playerId) || [];
            const playerDailyStreak = playerDailyStreaks[playerId] || {};

            // Get user info (userId and name)
            let userInfo = '';
            let currentPlayerInfo: { name: string; profileImage: string | null } = {
              name: '',
              profileImage: null,
            };
            try {
              const normalizedPlayerId = this.normalizeId(playerId);
              const user = normalizedPlayerId ? usersMap.get(normalizedPlayerId) : null;
              const userTyped = user as unknown as UserLean;
              const userName = userTyped?.name || userTyped?.username || '';
              userInfo = `${playerId}|${userName}`;
              // Get current player's info only
              currentPlayerInfo = {
                name: userName,
                profileImage: userTyped?.profileImage || null,
              };
            } catch (error) {
              userInfo = `${playerId}|`;
            }

            const personalizedGameOverData = {
              gameId,
              roomId: gameState.roomId,
              totalQuestions: questions.length,
              startedAt: gameState.startedAt,
              endedAt: new Date(),
              isCompleted: true,
              // Player's own result (win/loss/draw)
              myResult: playerResult,
              myScore: playerScore,
              myPoints: playerPoint,
              myAccuracy: playerAccuracy,
              myAnswers: playerAnswerRecords,
              myDailyStreak: playerDailyStreak,
              // Only current player's data
              playerScores: playerScore,
              playerAccuracy: playerAccuracy,
              playerPoints: playerPoint,
              // User info string: "userId|name"
              user: userInfo,
              // Only current player's info with name and profileImage
              playerInfo: {
                [playerId]: currentPlayerInfo,
              },
            };

            // Emit both camelCase and lowercase event names for compatibility
            playerSocket.emit('gameOver', personalizedGameOverData);
            // playerSocket.emit('gameover', personalizedGameOverData);
          }
        }),
      );
    } else {
      // Batch fetch all users
      const playerIds = players
        .map(p => this.normalizeId(p))
        .filter((id): id is string => !!id);

      const userModel = this.contentService.getUserModel();

      // Fetch all users in one query
      const allUsers = await userModel
        .find({ _id: { $in: playerIds } })
        .lean()
        .exec();

      // Create map
      const usersMap = new Map(allUsers.map(u => [this.normalizeId(u._id) || '', u]));

      // Send personalized gameOver to each player (without streak updates)
      await Promise.all(
        players.map(async (playerId) => {
          const playerSocket = this.userSockets.get(playerId);
          if (playerSocket) {
            const playerResult = playerResults.get(playerId) || 'draw';
            const playerScore = playerCorrectCounts.get(playerId) || 0;
            const playerPoint = playerPoints.get(playerId) || 0;
            const playerAccuracy = playerAccuracies.get(playerId) || 0;
            const playerAnswerRecords = playerAnswers.get(playerId) || [];

            // Get user info (userId and name)
            let userInfo = '';
            let currentPlayerInfo: { name: string; profileImage: string | null } = {
              name: '',
              profileImage: null,
            };
            try {
              const normalizedPlayerId = this.normalizeId(playerId);
              const user = normalizedPlayerId ? usersMap.get(normalizedPlayerId) : null;
              const userTyped = user as unknown as UserLean;
              const userName = userTyped?.name || userTyped?.username || '';
              userInfo = `${playerId}|${userName}`;
              // Get current player's info only
              currentPlayerInfo = {
                name: userName,
                profileImage: userTyped?.profileImage || null,
              };
            } catch (error) {
              userInfo = `${playerId}|`;
            }

            const personalizedGameOverData = {
              gameId,
              roomId: gameState.roomId,
              totalQuestions: questions.length,
              startedAt: gameState.startedAt,
              endedAt: new Date(),
              isCompleted: true,
              // Player's own result (win/loss/draw)
              myResult: playerResult,
              myScore: playerScore,
              myPoints: playerPoint,
              myAccuracy: playerAccuracy,
              myAnswers: playerAnswerRecords,
              // Only current player's data
              playerScores: playerScore,
              playerAccuracy: playerAccuracy,
              playerPoints: playerPoint,
              // User info string: "userId|name"
              user: userInfo,
              // Only current player's info with name and profileImage
              playerInfo: {
                [playerId]: currentPlayerInfo,
              },
            };

            // Emit both camelCase and lowercase event names for compatibility
            playerSocket.emit('gameOver', personalizedGameOverData);
            // playerSocket.emit('gameover', personalizedGameOverData);
          }
        }),
      );
    }

    // Clean up
    this.multiplayerGames.delete(gameState.roomId);
    console.log('[endMultiplayerGame] Multiplayer game ended and cleaned up:', {
      gameId,
      roomId: gameState.roomId,
    });
  }

  // -------------------------------------------------------------
  // END GAME — SEND SUMMARY AND UPDATE TOTAL GAMES PLAYED
  // -------------------------------------------------------------
  private async endGame(gameState: GameState) {
    console.log('[endGame] Ending single-player game:', {
      gameId: gameState.gameId,
      userId: gameState.userId,
      score: gameState.score,
      totalQuestions: gameState.questions.length,
      currentIndex: gameState.currentIndex,
      lives: gameState.lives,
    });

    if (gameState.timer) clearTimeout(gameState.timer);

    const { socket, score, questions, answers, startedAt } = gameState;

    // Calculate accuracy: (correct answers / total questions) * 100
    const totalQuestions = questions.length;
    const correctAnswers = answers.filter((answer) => answer.isCorrect).length;
    const accuracy =
      totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;
    const accuracyRounded = Math.round(accuracy * 100) / 100;

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

    // Increment totalGamesPlayed when game is completed
    await this.contentService.incrementTotalGamesPlayed(gameState.userId);

    // Update daily streak (Type 1: 7-day icons, Type 2: current streak)
    const updatedStreak = await this.contentService.updateDailyStreak(gameState.userId);

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

    // Get updated daily streak info to send to client
    const dailyStreakInfo = updatedStreak
      ? {
        currentDailyStreak: updatedStreak.currentDailyStreak || 0,
        longestDailyStreak: updatedStreak.longestDailyStreak || 0,
        dailyStreakIcons: updatedStreak.dailyStreakIcons || [],
      }
      : await this.contentService.getDailyStreak(gameState.userId);

    console.log('[endGame] Game completed, sending gameOver event:', {
      gameId: gameState.gameId,
      userId: gameState.userId,
      score,
      accuracy: accuracyRounded,
      livesLeft: gameState.lives,
    });

    const singlePlayerGameOverPayload = {
      gameId: gameState.gameId,
      roomId: undefined, // Single player games don't have roomId
      score,
      totalQuestions: questions.length,
      answers,
      livesLeft: gameState.lives,
      startedAt,
      endedAt: new Date(),
      isCompleted: true,
      accuracy: accuracyRounded,
      dailyStreak: dailyStreakInfo,
    };

    // Emit both camelCase and lowercase event names for compatibility
    socket.emit('gameOver', singlePlayerGameOverPayload);
    // socket.emit('gameover', singlePlayerGameOverPayload);

    this.activeGames.delete(gameState.userId);
    console.log('[endGame] Single-player game ended and cleaned up:', {
      gameId: gameState.gameId,
      userId: gameState.userId,
    });
  }

  @SubscribeMessage('inviteUser')
  async inviteUser(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: InviteUserPayload,
  ) {
    const inviterId = client.data.userId;
    console.log('[inviteUser] Event received:', {
      inviterId,
      data,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!inviterId) {
      console.log('[inviteUser] Error: Unauthorized - no inviterId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    // Check if user is blocked
    const { isBlocked } = await this.checkUserIsBlocked(inviterId);
    if (isBlocked) {
      console.log('[inviteUser] Error: User account is blocked:', { inviterId });
      return client.emit('errorMessage', { message: 'Your account is blocked' });
    }

    // Check if user is online
    const isOnline = await this.checkUserIsOnline(inviterId);
    console.log('[inviteUser] User online status:', { inviterId, isOnline });
    if (!isOnline) {
      console.log('[inviteUser] Error: User is not online');
      return client.emit('errorMessage', {
        message: 'You must be online to send invites. Please set your status to online.',
      });
    }

    // Check if user is already in an active room
    const existingRoom = this.contentService.getRoomByUserId(inviterId);
    const normalizedInviterId = this.normalizeId(inviterId);

    // Allow host (first participant) to send additional invites to add users to existing room
    if (existingRoom && existingRoom.participants.length > 1) {
      // Check if inviter is the host (first participant)
      const isHost = normalizedInviterId && existingRoom.participants[0] === normalizedInviterId;

      if (isHost) {
        // Host can send additional invites to add users to existing room
        // Use existing roomId so new users get added to the same room
        console.log('[inviteUser] Host sending additional invite to add users to existing room:', {
          inviterId: normalizedInviterId,
          roomId: existingRoom.roomId,
          currentParticipants: existingRoom.participants,
        });
        // Set gameId in data to use existing roomId
        if (!data.gameId) {
          data.gameId = existingRoom.roomId;
        }
      } else {
        // Non-host cannot send invites when already in a room
        console.log('[inviteUser] Non-host user already in active room, cannot send new invite:', {
          inviterId: normalizedInviterId,
          roomId: existingRoom.roomId,
          participants: existingRoom.participants,
        });
        return client.emit('errorMessage', {
          message: 'You are already in an active room. Please leave the current room before sending a new invite.',
        });
      }
    }

    // Only clear rooms if user is alone (no other participants)
    // This allows cleanup of stale single-user rooms
    if (existingRoom && existingRoom.participants.length === 1) {
      const clearedRooms = this.contentService.clearUserRooms(inviterId);
      console.log('[inviteUser] Cleared stale single-user room:', { inviterId, clearedRooms });
    }

    try {
      console.log('[inviteUser] Calling contentService.inviteUserToGame:', {
        inviterId,
        data,
      });
      const invite = await this.contentService.inviteUserToGame(
        inviterId,
        data,
      );
      console.log('[inviteUser] Invite created successfully:', {
        invite,
        isArray: Array.isArray(invite),
      });

      // Get inviter's name
      let inviterName = '';
      try {
        const inviter = await this.usersService.findById(inviterId);
        const inviterTyped = inviter as unknown as UserLean;
        inviterName = inviterTyped?.name || inviterTyped?.username || '';
      } catch (error) {
        // If unable to get name, leave it empty
        inviterName = '';
      }

      // Handle both single invite (backward compatibility) and multiple invites
      const invites = Array.isArray(invite) ? invite : [invite];

      // Get invited user IDs from the data
      const invitedUserIds: string[] = [];
      if (data.userIds && Array.isArray(data.userIds)) {
        // Multiple invites
        invitedUserIds.push(...data.userIds.map(id => this.normalizeId(id)).filter((id): id is string => !!id));
      } else if (data.userId) {
        // Single invite (backward compatibility)
        const normalizedId = this.normalizeId(data.userId);
        if (normalizedId) {
          invitedUserIds.push(normalizedId);
        }
      }

      // Prepare invite response
      const inviteResponse = {
        success: true,
        invite: Array.isArray(invite) ? invite : invite, // Return array if multiple, single if one
        invites: invites, // Always return as array for consistency
        inviterName: inviterName, // Add inviter's name
      };

      // Send inviteUserResponse only to invited users (not all users)
      console.log('[inviteUser] Sending invites to users:', {
        invitedUserIds,
        totalInvites: invitedUserIds.length,
      });
      invitedUserIds.forEach((invitedUserId) => {
        const invitedUserSocket = this.userSockets.get(invitedUserId);
        if (invitedUserSocket) {
          console.log('[inviteUser] Emitting inviteUserResponse to user:', {
            invitedUserId,
            socketId: invitedUserSocket.id,
            inviteResponse,
          });
          invitedUserSocket.emit('inviteUserResponse', inviteResponse);
        } else {
          console.warn('[inviteUser] User socket not found:', {
            invitedUserId,
            availableSockets: Array.from(this.userSockets.keys()),
          });
        }
      });
      console.log('[inviteUser] Invite process completed successfully');
    } catch (error) {
      console.error('[inviteUser] Error occurred:', {
        inviterId,
        error: error.message,
        stack: error.stack,
        data,
      });
      client.emit('errorMessage', {
        message: error.message || 'Failed to send invite',
      });
    }
  }

  @SubscribeMessage('acceptInvite')
  async acceptInvite(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: AcceptInvitePayload,
  ) {
    const acceptorId = client.data.userId;
    console.log('[acceptInvite] Event received:', {
      acceptorId,
      data,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!acceptorId) {
      console.log('[acceptInvite] Error: Unauthorized - no acceptorId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    // Check if user is online
    const isOnline = await this.checkUserIsOnline(acceptorId);
    console.log('[acceptInvite] User online status:', { acceptorId, isOnline });
    if (!isOnline) {
      console.log('[acceptInvite] Error: User is not online');
      return client.emit('errorMessage', {
        message: 'You must be online to accept invites. Please set your status to online.',
      });
    }

    // DO NOT clear rooms on acceptInvite - user might be rejoining after reconnect
    // Only check if user is already in a different active room
    const existingRoom = this.contentService.getRoomByUserId(acceptorId);
    if (existingRoom && existingRoom.participants.length > 1) {
      console.log('[acceptInvite] User already in active room:', {
        acceptorId,
        existingRoomId: existingRoom.roomId,
        participants: existingRoom.participants,
      });
      // Allow accepting if it's the same room or if user explicitly wants to switch
      // For now, we'll allow it and let the acceptInvite logic handle it
    }

    try {
      console.log('[acceptInvite] Calling contentService.acceptInvite:', {
        acceptorId,
        data,
      });
      const room = await this.contentService.acceptInvite(acceptorId, data);
      console.log('[acceptInvite] Room created/updated:', {
        room,
        roomId: room.roomId,
      });

      // Get all participants from the room
      const activeRoom = this.contentService.getRoomByRoomId(room.roomId);
      const participants = activeRoom?.participants || [room.inviterId, room.inviteeId];
      console.log('[acceptInvite] Room participants:', {
        roomId: room.roomId,
        participants,
        activeRoom: activeRoom ? 'found' : 'not found',
      });

      // Join all participants to the room
      participants.forEach((participantId) => {
        const participantSocket = this.userSockets.get(participantId);
        if (participantSocket) {
          console.log('[acceptInvite] Joining participant to room:', {
            participantId,
            roomId: room.roomId,
            socketId: participantSocket.id,
          });
          participantSocket.join(room.roomId);
        } else {
          console.warn('[acceptInvite] Participant socket not found:', {
            participantId,
            availableSockets: Array.from(this.userSockets.keys()),
          });
        }
      });

      // Check if this is an auto-invite and start game automatically when enough users accept
      const normalizedInviterId = this.normalizeId(room.inviterId);
      const autoInviteState = normalizedInviterId ? this.autoInviteStates.get(normalizedInviterId) : null;
      console.log('[acceptInvite] Auto-invite check:', {
        normalizedInviterId,
        hasAutoInviteState: !!autoInviteState,
        isGameStarted: autoInviteState?.isGameStarted,
        acceptedCount: autoInviteState?.acceptedCount,
        requiredAcceptances: autoInviteState?.requiredAcceptances,
      });
      if (autoInviteState && !autoInviteState.isGameStarted) {
        // Increment accepted count
        autoInviteState.acceptedCount += 1;
        console.log('[acceptInvite] Incremented accepted count:', {
          acceptedCount: autoInviteState.acceptedCount,
          requiredAcceptances: autoInviteState.requiredAcceptances,
        });

        // Get room with participants
        const activeRoom = this.contentService.getRoomByRoomId(room.roomId);
        if (!activeRoom) {
          throw new Error('Room not found');
        }

        // Check if enough users have accepted to start the game
        if (autoInviteState.acceptedCount >= autoInviteState.requiredAcceptances) {
          console.log('[acceptInvite] Enough acceptances received, checking participants:', {
            acceptedCount: autoInviteState.acceptedCount,
            requiredAcceptances: autoInviteState.requiredAcceptances,
            currentParticipants: activeRoom.participants.length,
          });
          // Verify room has at least the required number of participants
          const expectedParticipants = autoInviteState.mode === 'DUEL'
            ? 2
            : (autoInviteState.member || 2);

          if (activeRoom.participants.length < expectedParticipants) {
            // Wait for more participants
            console.warn('[acceptInvite] Not enough participants yet:', {
              current: activeRoom.participants.length,
              required: expectedParticipants,
              participants: activeRoom.participants,
            });
            // Don't start game yet, wait for correct number
            return;
          }

          // Clear all pending timeouts to stop sequential invites
          autoInviteState.timeoutIds.forEach((timeoutId) => clearTimeout(timeoutId));
          autoInviteState.timeoutIds = [];
          autoInviteState.isGameStarted = true;
          autoInviteState.gameId = room.roomId;

          // Start the game automatically with random deck
          try {
            const mode = autoInviteState.mode || 'DUEL';
            const member = autoInviteState.member;

            const result = await this.contentService.createMultiplayerGame(
              room.inviterId,
              mode,
              'random',
              undefined,
              room.roomId,
              activeRoom.participants,
              undefined, // gameMode (Regular/Knockout)
              member, // member count for BRAWL
            );

            const gameModel = this.contentService.getGameModel();
            const game = await gameModel.findOne({ gameId: result.gameId }).lean().exec();

            if (!game) {
              throw new Error('Game not found after creation');
            }

            const { subTopic, topic } =
              await this.contentService.getSubTopicAndTopic(game.subTopicId);

            // Calculate topicId, subTopicIndex and totalSubTopics (same as single-player)
            const autoTopicId = this.normalizeId(topic._id) as string;
            const autoOrderedSubTopicIds = (topic.subTopics ?? [])
              .map((id) => this.normalizeId(id))
              .filter((id): id is string => !!id);
            const autoNormalizedSubTopicId = this.normalizeId(
              game.subTopicId,
            ) as string;
            const autoSubTopicIndex =
              autoOrderedSubTopicIds.findIndex(
                (id) => id === autoNormalizedSubTopicId,
              ) + 1;
            const autoTotalSubTopics = autoOrderedSubTopicIds.length;

            const aiService = this.contentService.getAiService();
            const questions = await aiService.generateMCQQuestions(
              subTopic.title,
              subTopic.description,
              game.difficulty || 'medium',
            );

            if (!Array.isArray(questions) || questions.length === 0) {
              throw new Error('No questions available for this topic');
            }

            await gameModel.updateOne(
              { gameId: result.gameId },
              {
                $set: {
                  questions,
                  gameStarted: true,
                  startTime: new Date(),
                  currentQuestion: 0,
                  round: 1, // Set round to 1 for auto-started game
                },
              },
            );

            const multiplayerState: MultiplayerGameState = {
              gameId: result.gameId,
              roomId: room.roomId,
              players: game.players,
              subTopicId: game.subTopicId,
              questions,
              currentIndex: 0,
              playerAnswers: new Map(),
              playerScores: new Map(),
              playerWrongAnswers: new Map(),
              eliminatedPlayers: new Set(),
              gameMode: (game.metadata as unknown as GameMetadata)?.gameMode as 'Regular' | 'Knockout' | undefined,
              startedAt: new Date(),
              isCompleted: false,
            };

            game.players.forEach((playerId) => {
              multiplayerState.playerScores.set(playerId, 0);
              multiplayerState.playerAnswers.set(playerId, []);
              multiplayerState.playerWrongAnswers.set(playerId, 0);
            });

            this.multiplayerGames.set(room.roomId, multiplayerState);

            // Get host user to mirror single-player lives field
            const hostUser = await this.usersService.findById(room.inviterId);
            const hostLives =
              hostUser && Number.isInteger(hostUser.lives) && hostUser.lives > 0
                ? hostUser.lives
                : 0;

            // Build per-player coins map: { [userId]: coins }
            const playerCoins: Record<string, number> = {};
            // Build per-player user info map: { [userId]: { name, profileImage, isHost } }
            const playerInfo: Record<string, { name: string; profileImage: string | null; isHost: boolean }> = {};
            // Build per-player points map: { [userId]: points }
            const playerPoints: Record<string, number> = {};
            // Build per-player level map: { [userId]: { levelName, name } }
            const playerLevel: Record<string, { levelName: string; name: string }> = {};
            // Build per-player winner rate map: { [userId]: winnerRate }
            const winnerRate: Record<string, number> = {};
            // Get host ID (first participant)
            const hostId = this.normalizeId(activeRoom.participants[0]);

            // Batch fetch all users and game progress
            const participantIds = activeRoom.participants
              .map(p => this.normalizeId(p))
              .filter((id): id is string => !!id);

            const userModel = this.contentService.getUserModel();
            const gameProgressModel = this.contentService.getGameProgressModel();

            // 1. Fetch all users in one query
            const allUsers = await userModel
              .find({ _id: { $in: participantIds } })
              .lean()
              .exec();

            // 2. Fetch all game progress in one query
            const allGameProgress = await gameProgressModel
              .find({ userId: { $in: participantIds } })
              .lean()
              .exec();

            // 3. Create maps
            const usersMap = new Map(allUsers.map(u => [this.normalizeId(u._id) || '', u]));
            const progressMap = new Map(
              allGameProgress.map(gp => [this.normalizeId(gp.userId) || '', gp])
            );

            // 4. Process participants using maps (no queries)
            participantIds.forEach((normalizedId) => {
              const player = usersMap.get(normalizedId);
              const gameProgress = progressMap.get(normalizedId);

              try {
                const playerTyped = player as unknown as UserLean;
                const coins =
                  player &&
                    typeof playerTyped?.coins === 'number' &&
                    Number.isFinite(playerTyped.coins)
                    ? playerTyped.coins
                    : 0;
                playerCoins[normalizedId] = coins;

                // Get user name and profile image
                const userName = playerTyped?.name || playerTyped?.username || '';
                const userProfileImage = playerTyped?.profileImage || null;
                // Check if this player is the host (first participant)
                const isHost = normalizedId === hostId;
                playerInfo[normalizedId] = {
                  name: userName,
                  profileImage: userProfileImage,
                  isHost: isHost,
                };

                // Get GameProgress for points, level, and winner rate
                if (gameProgress) {
                  // Points
                  const points = typeof gameProgress.points === 'number' && Number.isFinite(gameProgress.points)
                    ? gameProgress.points
                    : 0;
                  playerPoints[normalizedId] = points;

                  // Level name with name
                  const level = typeof gameProgress.level === 'number' && Number.isFinite(gameProgress.level)
                    ? gameProgress.level
                    : 1;
                  const levelName = this.contentService.getLevelNameForLevel(level);
                  playerLevel[normalizedId] = {
                    levelName: levelName,
                    name: userName,
                  };

                  // Winner rate: totalWins / totalGamesPlayed
                  const totalWins = typeof gameProgress.totalWins === 'number' && Number.isFinite(gameProgress.totalWins)
                    ? gameProgress.totalWins
                    : 0;
                  const totalGamesPlayed = typeof gameProgress.totalGamesPlayed === 'number' && Number.isFinite(gameProgress.totalGamesPlayed)
                    ? gameProgress.totalGamesPlayed
                    : 0;
                  const calculatedWinnerRate = totalGamesPlayed > 0 ? (totalWins / totalGamesPlayed) : 0;
                  // Round to 2 decimal places
                  winnerRate[normalizedId] = Math.round(calculatedWinnerRate * 100) / 100;
                } else {
                  // Default values if GameProgress not found
                  playerPoints[normalizedId] = 0;
                  playerLevel[normalizedId] = {
                    levelName: 'Awakened', // Default level name for level 1
                    name: userName,
                  };
                  winnerRate[normalizedId] = 0;
                }
              } catch {
                playerCoins[normalizedId] = 0;
                // Check if this player is the host (first participant)
                const isHost = normalizedId === hostId;
                playerInfo[normalizedId] = {
                  name: '',
                  profileImage: null,
                  isHost: isHost,
                };
                playerPoints[normalizedId] = 0;
                playerLevel[normalizedId] = {
                  levelName: 'Awakened', // Default level name for level 1
                  name: '',
                };
                winnerRate[normalizedId] = 0;
              }
            });

            // Notify all players that game is created with ALL data (no separate gameStart needed)
            // This matches the createGame pattern where gameCreated contains everything
            this.server.to(room.roomId).emit('gameCreated', {
              success: true,
              gameId: result.gameId,
              roomId: room.roomId,
              deckId: result.deckId,
              deckName: result.deckName,
              topicId: autoTopicId,
              subTopicId: autoNormalizedSubTopicId,
              totalQuestions: questions.length,
              lives: hostLives,
              timePerQuestion: QUESTION_TIME_SECONDS,
              subTopicIndex: autoSubTopicIndex,
              totalSubTopics: autoTotalSubTopics,
              round: 1, // Round is always 1 for auto-started game
              // coins per player, e.g. { "userId1": 10, "userId2": 5 }
              coins: playerCoins,
              // player info per player, e.g. { "userId1": { name: "John", profileImage: "url" }, "userId2": { name: "Jane", profileImage: "url" } }
              playerInfo: playerInfo,
              // player points per player, e.g. { "userId1": 100, "userId2": 50 }
              playerPoints: playerPoints,
              // player level per player with name, e.g. { "userId1": { levelName: "Catalysts", name: "John" }, "userId2": { levelName: "Pathfinders", name: "Jane" } }
              playerLevel: playerLevel,
              // winner rate per player (totalWins / totalGamesPlayed), e.g. { "userId1": 0.75, "userId2": 0.50 }
              winnerRate: winnerRate,
              questions,
              mode: mode,
              topicType: 'random',
              players: activeRoom.participants,
              gameMode: undefined, // Auto-start defaults to Regular
              member: member,
              eliminatedPlayers: [], // Empty at start, will be updated as players get eliminated
            });
            // NOTE: No separate gameStart event needed - all data is in gameCreated
          } catch (error) {
            console.error('Failed to auto-start game:', error);
          }
        } else {
          // Not enough users accepted yet, wait for more
          // Don't start the game, just wait
        }
      }

      // Get host ID (first participant)
      const hostId = this.normalizeId(participants[0]);

      // Fetch all participant details (name, profileImage, isHost)
      const participantDetails: Array<{
        userId: string;
        name: string;
        profileImage: string | null;
        isHost: boolean;
      }> = [];

      // Batch fetch all users
      const participantIds = participants
        .map(p => this.normalizeId(p))
        .filter((id): id is string => !!id);

      const userModel = this.contentService.getUserModel();

      // Fetch all users in one query
      const allUsers = await userModel
        .find({ _id: { $in: participantIds } })
        .lean()
        .exec();

      // Create map
      const usersMap = new Map(allUsers.map(u => [this.normalizeId(u._id) || '', u]));

      // Get acceptor's name and profile image from batch query result
      const normalizedAcceptorId = this.normalizeId(acceptorId);
      const acceptor = normalizedAcceptorId ? usersMap.get(normalizedAcceptorId) : null;
      const acceptorTyped = acceptor as unknown as UserLean;
      const acceptorName = acceptorTyped?.name || acceptorTyped?.username || '';
      const acceptorProfileImage = acceptorTyped?.profileImage || null;

      // Process participants using map (no queries)
      participantIds.forEach((normalizedId) => {
        const participant = usersMap.get(normalizedId);

        try {
          const participantTyped = participant as unknown as UserLean;
          const userName = participantTyped?.name || participantTyped?.username || '';
          const userProfileImage = participantTyped?.profileImage || null;
          const isHost = normalizedId === hostId;

          participantDetails.push({
            userId: normalizedId,
            name: userName,
            profileImage: userProfileImage,
            isHost: isHost,
          });

          console.log('[acceptInvite] Participant details fetched:', {
            userId: normalizedId,
            name: userName,
            hasProfileImage: !!userProfileImage,
            isHost,
          });
        } catch (error) {
          console.warn('[acceptInvite] Failed to fetch participant info:', {
            participantId: normalizedId,
            error: error.message,
          });
          // Add participant with default values
          participantDetails.push({
            userId: normalizedId,
            name: '',
            profileImage: null,
            isHost: normalizedId === hostId,
          });
        }
      });

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
      console.log('[acceptInvite] Emitting inviteAccepted to room:', {
        roomId: room.roomId,
        payload: inviteAcceptedPayload,
        participants,
      });
      this.server.to(room.roomId).emit('inviteAccepted', inviteAcceptedPayload);

      // Emit roomDetails event with full room details and participant info
      const roomDetailsPayload = {
        roomId: room.roomId,
        inviterId: room.inviterId,
        inviteeId: room.inviteeId,
        deviceId: room.deviceId,
        gameId: room.gameId,
        participants: participantDetails, // Array of participants with name, profileImage, isHost
      };
      console.log('[acceptInvite] Emitting roomDetails to room:', {
        roomId: room.roomId,
        payload: roomDetailsPayload,
        participantCount: participantDetails.length,
      });
      this.server.to(room.roomId).emit('roomDetails', roomDetailsPayload);

      console.log('[acceptInvite] Invite accepted process completed successfully');
    } catch (error) {
      console.error('[acceptInvite] Error occurred:', {
        acceptorId,
        error: error.message,
        stack: error.stack,
        data,
      });
      client.emit('errorMessage', {
        message: error?.message || 'Failed to accept invite',
      });
    }
  }

  // @SubscribeMessage('joinRoom')
  // async joinRoom(
  //   @ConnectedSocket() client: Socket,
  //   @MessageBody() data: { roomId?: string },
  // ) {
  //   const userId = client.data.userId;
  //   console.log('[joinRoom] Event received:', {
  //     userId,
  //     data,
  //     socketId: client.id,
  //     timestamp: new Date().toISOString(),
  //   });

  //   if (!userId) {
  //     console.log('[joinRoom] Error: Unauthorized - no userId');
  //     return client.emit('errorMessage', { message: 'Unauthorized' });
  //   }

  //   try {
  //     // Check if user is in a room
  //     const room = data.roomId
  //       ? this.contentService.getRoomByRoomId(data.roomId)
  //       : this.contentService.getRoomByUserId(userId);

  //     if (!room) {
  //       console.log('[joinRoom] Error: User not in any room:', {
  //         userId,
  //         requestedRoomId: data.roomId,
  //       });
  //       return client.emit('errorMessage', {
  //         message: 'You are not in any active room',
  //       });
  //     }

  //     // Verify user is a participant in the room
  //     const normalizedUserId = this.normalizeId(userId);
  //     if (!normalizedUserId || !room.participants.includes(normalizedUserId)) {
  //       console.log('[joinRoom] Error: User not a participant in room:', {
  //         userId: normalizedUserId,
  //         roomId: room.roomId,
  //         participants: room.participants,
  //       });
  //       return client.emit('errorMessage', {
  //         message: 'You are not a participant in this room',
  //       });
  //     }

  //     // Join the socket to the room
  //     client.join(room.roomId);
  //     console.log('[joinRoom] User joined room successfully:', {
  //       userId: normalizedUserId,
  //       roomId: room.roomId,
  //       socketId: client.id,
  //       participants: room.participants,
  //     });

  //     // Return room info to client
  //     client.emit('joinRoomResponse', {
  //       success: true,
  //       roomId: room.roomId,
  //       participants: room.participants,
  //       gameId: room.gameId,
  //     });
  //   } catch (error) {
  //     console.error('[joinRoom] Error occurred:', {
  //       userId,
  //       error: error.message,
  //       stack: error.stack,
  //       data,
  //     });
  //     client.emit('errorMessage', {
  //       message: error?.message || 'Failed to join room',
  //     });
  //   }
  // }

  @SubscribeMessage('cancelInvite')
  async cancelInvite(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: CancelInvitePayload,
  ) {
    const userId = client.data.userId;
    console.log('[cancelInvite] Event received:', {
      userId,
      data,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[cancelInvite] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    try {
      const result = await this.contentService.cancelInvite(userId, data);

      // Get canceller's name for inviter to see who cancelled
      let cancellerName = '';
      try {
        const canceller = await this.usersService.findById(userId);
        const cancellerTyped = canceller as unknown as UserLean;
        cancellerName = cancellerTyped?.name || cancellerTyped?.username || '';
      } catch (error) {
        // If unable to get name, leave it empty
        cancellerName = '';
      }

      client.emit('cancelInviteResponse', {
        success: true,
        result,
        cancellerName: cancellerName, // Add canceller's name
      });

      // Notify inviter about canceled invite
      const inviterSocket = this.userSockets.get(data.inviterId);
      if (inviterSocket) {
        inviterSocket.emit('inviteCanceled', {
          inviterId: data.inviterId,
          gameId: data.gameId,
          cancellerName: cancellerName, // Add canceller's name so inviter can see who cancelled
        });
      }
      console.log('[cancelInvite] Invite cancelled successfully:', {
        userId,
        inviterId: data.inviterId,
        gameId: data.gameId,
      });
    } catch (error) {
      console.error('[cancelInvite] Error occurred:', {
        userId,
        error: error.message,
        stack: error.stack,
        data,
      });
      client.emit('errorMessage', {
        message: error?.message || 'Failed to cancel invite',
      });
    }
  }

  @SubscribeMessage('leaveUser')
  async leaveUser(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId;
    console.log('[leaveUser] Event received:', {
      userId,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[leaveUser] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    try {
      // Check if user is in a room
      const room = this.contentService.getRoomByUserId(userId);
      if (!room) {
        console.log('[leaveUser] Error: User not in any active room:', { userId });
        return client.emit('errorMessage', {
          message: 'You are not in any active room',
        });
      }

      console.log('[leaveUser] User leaving room:', {
        userId,
        roomId: room.roomId,
        participants: room.participants,
      });

      // Check if there's an active multiplayer game for this room
      const multiplayerState = this.multiplayerGames.get(room.roomId);
      let shouldContinueGame = false;

      // Check if leaving user is the host (first participant who created the game)
      const normalizedUserId = this.normalizeId(userId);
      const isHost = room.participants[0] === normalizedUserId;
      console.log('[leaveUser] Host check:', {
        userId: normalizedUserId,
        isHost,
        firstParticipant: room.participants[0],
      });

      if (multiplayerState) {
        // If host leaves, always end the game regardless of mode
        if (isHost) {
          await this.endMultiplayerGame(multiplayerState, true, userId);
          this.server.to(room.roomId).emit('gameAborted', {
            message: 'Host left the room. Game ended.',
            roomId: room.roomId,
            userId,
          });
        } else {
          // Get game from database to check mode
          const gameModel = this.contentService.getGameModel();
          const game = await gameModel.findOne({ gameId: multiplayerState.gameId }).lean().exec();

          if (game) {
            const isBrawlMode = game.gameMode === 'brawl';
            const remainingPlayers = multiplayerState.players.filter(
              (p) => this.normalizeId(p) !== normalizedUserId
            );

            // If BRAWL mode and at least 2 players remain, remove user and continue game
            if (isBrawlMode && remainingPlayers.length >= 2) {
              await this.removePlayerFromGame(multiplayerState, userId, room.roomId);
              shouldContinueGame = true;

              // Notify remaining players in room that a player left but game continues
              this.server.to(room.roomId).emit('playerLeftGame', {
                message: 'A player left the game',
                roomId: room.roomId,
                gameId: multiplayerState.gameId,
                leavingUserId: userId,
                remainingPlayers: remainingPlayers,
                gameContinues: true,
              });
            } else {
              // End the game without awarding points and coins
              // Mark leaving user as loser and remaining player as winner
              await this.endMultiplayerGame(multiplayerState, true, userId);

              // Notify all players in room that game was aborted
              this.server.to(room.roomId).emit('gameAborted', {
                message: 'A player left the room',
                roomId: room.roomId,
                userId,
              });
            }
          } else {
            // If game not found in DB, end the game
            await this.endMultiplayerGame(multiplayerState, true, userId);
            this.server.to(room.roomId).emit('gameAborted', {
              message: 'A player left the room',
              roomId: room.roomId,
              userId,
            });
          }
        }
      }

      // Remove user from room (only delete room if game is not continuing)
      const result = shouldContinueGame
        ? await this.contentService.removeUserFromRoomParticipants(room.roomId, userId)
        : await this.contentService.leaveUser(userId);

      console.log('[leaveUser] User left successfully:', {
        userId,
        roomId: room.roomId,
        shouldContinueGame,
      });

      client.emit('leaveUserResponse', {
        success: true,
        result,
      });
    } catch (error) {
      console.error('[leaveUser] Error occurred:', {
        userId,
        error: error.message,
        stack: error.stack,
      });
      client.emit('errorMessage', {
        message: error?.message || 'Failed to leave room',
      });
    }
  }

  @SubscribeMessage('removeUserFromRoom')
  async removeUserFromRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetUserId: string },
  ) {
    const userId = client.data.userId;
    console.log('[removeUserFromRoom] Event received:', {
      userId,
      data,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[removeUserFromRoom] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    const { targetUserId } = data;

    if (!targetUserId) {
      console.log('[removeUserFromRoom] Error: targetUserId is required');
      return client.emit('errorMessage', {
        message: 'targetUserId is required',
      });
    }

    try {
      // Check if user is in a room
      const room = this.contentService.getRoomByUserId(userId);
      if (!room) {
        console.log('[removeUserFromRoom] Error: User not in any active room:', { userId });
        return client.emit('errorMessage', {
          message: 'You are not in any active room',
        });
      }

      console.log('[removeUserFromRoom] Removing user from room:', {
        userId,
        targetUserId,
        roomId: room.roomId,
        participants: room.participants,
      });

      // Check if there's an active multiplayer game for this room
      const multiplayerState = this.multiplayerGames.get(room.roomId);
      let shouldContinueGame = false;

      // Check if target user being removed is the host (first participant who created the game)
      const normalizedTargetUserId = this.normalizeId(targetUserId);
      const isHost = normalizedTargetUserId && room.participants[0] === normalizedTargetUserId;
      console.log('[removeUserFromRoom] Host check:', {
        targetUserId: normalizedTargetUserId,
        isHost,
        firstParticipant: room.participants[0],
      });

      if (multiplayerState) {
        // Check if target user is a player in the game
        if (normalizedTargetUserId && multiplayerState.players.includes(normalizedTargetUserId)) {
          // If host is being removed, always end the game regardless of mode
          if (isHost) {
            await this.endMultiplayerGame(multiplayerState, true, targetUserId);
            this.server.to(room.roomId).emit('gameAborted', {
              message: 'Host was removed from the room. Game ended.',
              roomId: room.roomId,
              userId: targetUserId,
            });
          } else {
            // Get game from database to check mode
            const gameModel = this.contentService.getGameModel();
            const game = await gameModel.findOne({ gameId: multiplayerState.gameId }).lean().exec();

            if (game) {
              const isBrawlMode = game.gameMode === 'brawl';
              const remainingPlayers = multiplayerState.players.filter(
                (p) => this.normalizeId(p) !== normalizedTargetUserId
              );

              // If BRAWL mode and at least 2 players remain, remove user and continue game
              if (isBrawlMode && remainingPlayers.length >= 2) {
                await this.removePlayerFromGame(multiplayerState, targetUserId, room.roomId);
                shouldContinueGame = true;

                // Notify remaining players in room that a player was removed but game continues
                this.server.to(room.roomId).emit('playerLeftGame', {
                  message: 'A player was removed from the game',
                  roomId: room.roomId,
                  gameId: multiplayerState.gameId,
                  leavingUserId: targetUserId,
                  remainingPlayers: remainingPlayers,
                  gameContinues: true,
                });
              } else {
                // End the game without awarding points and coins
                // Mark removed user as loser and remaining player as winner
                await this.endMultiplayerGame(multiplayerState, true, targetUserId);

                // Notify all players in room that game was aborted
                this.server.to(room.roomId).emit('gameAborted', {
                  message: 'A player was removed from the room',
                  roomId: room.roomId,
                  userId: targetUserId,
                });
              }
            } else {
              // If game not found in DB, end the game
              await this.endMultiplayerGame(multiplayerState, true, targetUserId);
              this.server.to(room.roomId).emit('gameAborted', {
                message: 'A player was removed from the room',
                roomId: room.roomId,
                userId: targetUserId,
              });
            }
          }
        }
      }

      // Remove user from room (only delete room if game is not continuing)
      const result = shouldContinueGame
        ? await this.contentService.removeUserFromRoomParticipants(room.roomId, targetUserId)
        : await this.contentService.removeUserFromRoom(userId, targetUserId);

      console.log('[removeUserFromRoom] User removed successfully:', {
        userId,
        targetUserId,
        roomId: room.roomId,
        shouldContinueGame,
      });

      client.emit('removeUserFromRoomResponse', {
        success: true,
        result,
      });
    } catch (error) {
      console.error('[removeUserFromRoom] Error occurred:', {
        userId,
        targetUserId,
        error: error.message,
        stack: error.stack,
        data,
      });
      client.emit('errorMessage', {
        message: error?.message || 'Failed to remove user from room',
      });
    }
  }

  @SubscribeMessage('isOnline')
  async isOnline(
    @ConnectedSocket() client: Socket,
    @MessageBody() data?: { isOnline?: boolean },
  ) {
    const userId = client.data.userId;
    console.log('[isOnline] Event received:', {
      userId,
      data,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[isOnline] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    try {
      let result;

      // If isOnline is explicitly provided, use updateUserOnlineStatus
      // Otherwise, toggle the current status
      if (data?.isOnline !== undefined) {
        result = await this.contentService.updateUserOnlineStatus(
          userId,
          data.isOnline,
        );
      } else {
        // Toggle the status (first call = true, second = false, third = true, etc.)
        result = await this.contentService.toggleUserOnlineStatus(userId);
      }

      client.emit('isOnline', { success: true, result, isOnline: result.isOnline });
      return result;
    } catch (error) {
      console.error('[isOnline] Error occurred:', {
        userId,
        error: error.message,
        stack: error.stack,
        data,
      });
      return client.emit('errorMessage', {
        message: error.message || 'Failed to update online status',
      });
    }
  }

  @SubscribeMessage('getOnlineUsers')
  async getOnlineUsers(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId;
    console.log('[getOnlineUsers] Event received:', {
      userId,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[getOnlineUsers] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    try {
      const result = await this.contentService.getOnlineUsers();
      client.emit('getOnlineUsers', { success: true, result });
      return result;
    } catch (error) {
      console.error('[getOnlineUsers] Error occurred:', {
        userId,
        error: error.message,
        stack: error.stack,
      });
      return client.emit('errorMessage', {
        message: error.message || 'Failed to get online users',
      });
    }
  }

  @SubscribeMessage('shearchOnilneUsersName')
  async shearchOnilneUsersName(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { name: string },
  ) {
    const userId = client.data.userId;
    console.log('[shearchOnilneUsersName] Event received:', {
      userId,
      data,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[shearchOnilneUsersName] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    const searchTerm = data?.name?.trim();
    if (!searchTerm) {
      return client.emit('errorMessage', {
        message: 'name is required for search',
      });
    }

    try {
      const users = await this.contentService.shearchOnilneUsersName(
        searchTerm,
        userId,
      );
      client.emit('shearchOnilneUsersName', { success: true, users });
    } catch (error) {
      console.error('[shearchOnilneUsersName] Error occurred:', {
        userId,
        error: error.message,
        stack: error.stack,
        data,
      });
      client.emit('errorMessage', {
        message: error.message || 'Failed to search online users',
      });
    }
  }

  @SubscribeMessage('randomDeckSelected')
  async randomDeckSelected(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId;
    console.log('[randomDeckSelected] Event received:', {
      userId,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[randomDeckSelected] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    try {
      const randomDeck = await this.contentService.getRandomDeck();

      // Store the selected random deck for this user
      const normalizedUserId = this.normalizeId(userId);
      if (normalizedUserId && randomDeck) {
        this.userSelectedRandomDeck.set(normalizedUserId, randomDeck);
      }

      client.emit('randomDeckSelected', { success: true, deck: randomDeck });
    } catch (error) {
      console.error('[randomDeckSelected] Error occurred:', {
        userId,
        error: error.message,
        stack: error.stack,
      });
      client.emit('errorMessage', {
        message: error.message || 'Failed to get random deck',
      });
    }
  }

  // -------------------------------------------------------------
  // ASK QUESTION
  // Client emits: askQuestion { subTopicId, question }
  // -------------------------------------------------------------
  @SubscribeMessage('askQuestion')
  async askQuestion(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { subTopicId: string; question: string },
  ) {
    const userId = client.data.userId as string;
    console.log('[askQuestion] Event received:', {
      userId,
      data,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[askQuestion] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    const { subTopicId, question } = data || {};

    if (!subTopicId) {
      return client.emit('errorMessage', {
        message: 'subTopicId is required',
      });
    }

    if (!question || !question.trim()) {
      return client.emit('errorMessage', {
        message: 'question is required',
      });
    }

    try {
      const result = await this.contentService.askQuestion(
        subTopicId,
        question.trim(),
        userId,
      );
      client.emit('askQuestion', { success: true, ...result });
    } catch (error) {
      console.error('[askQuestion] Error occurred:', {
        userId,
        error: error.message,
        stack: error.stack,
        data,
      });
      client.emit('errorMessage', {
        message: error.message || 'Failed to get answer',
      });
    }
  }

  // -------------------------------------------------------------
  // MORE DETAILS
  // Client emits: moreDetails { subTopicId }
  // -------------------------------------------------------------
  @SubscribeMessage('moreDetails')
  async moreDetails(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { subTopicId: string },
  ) {
    const userId = client.data.userId as string;
    console.log('[moreDetails] Event received:', {
      userId,
      data,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[moreDetails] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    const { subTopicId } = data || {};

    if (!subTopicId) {
      return client.emit('errorMessage', {
        message: 'subTopicId is required',
      });
    }

    try {
      const result = await this.contentService.getMoreDetails(
        subTopicId,
        userId,
      );
      client.emit('moreDetails', { success: true, ...result });
    } catch (error) {
      console.error('[moreDetails] Error occurred:', {
        userId,
        error: error.message,
        stack: error.stack,
        data,
      });
      client.emit('errorMessage', {
        message: error.message || 'Failed to get more details',
      });
    }
  }

  // -------------------------------------------------------------
  // USE HINT
  // Client emits: useHint
  // -------------------------------------------------------------
  // @SubscribeMessage('useHint')
  // async useHint(
  //   @ConnectedSocket() client: Socket,
  //   @MessageBody() data?: any,
  // ) {
  //   const userId = client.data.userId as string;
  //   const deviceId =
  //     client.data.deviceId || client.handshake.headers['x-device-id'];

  //   try {
  //     const result = await this.contentService.useHint(userId, deviceId);

  //     // Emit the result to the client
  //     client.emit('hintUsed', result);

  //     return result;
  //   } catch (error) {
  //     client.emit('errorMessage', {
  //       message: error.message || 'Failed to use hint',
  //     });
  //   }
  // }

  // -------------------------------------------------------------
  // GET USER LEVEL AND BADGE
  // Client emits: getUserLevelAndBadge
  // Returns user's current level and badge based on their points
  // -------------------------------------------------------------
  @SubscribeMessage('getUserLevelAndBadge')
  async getUserLevelAndBadge(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId as string;
    console.log('[getUserLevelAndBadge] Event received:', {
      userId,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[getUserLevelAndBadge] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    try {
      const result = await this.contentService.getUserLevelAndBadge(userId);
      client.emit('getUserLevelAndBadge', { success: true, ...result });
      return result;
    } catch (error) {
      console.error('[getUserLevelAndBadge] Error occurred:', {
        userId,
        error: error.message,
        stack: error.stack,
      });
      client.emit('errorMessage', {
        message: error?.message || 'Failed to get user level and badge',
      });
    }
  }

  // -------------------------------------------------------------
  // GET DAILY STREAK
  // Client emits: getDailyStreak
  // Returns user's daily streak information (7-day icons and current streak)
  // -------------------------------------------------------------
  @SubscribeMessage('getDailyStreak')
  async getDailyStreak(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId as string;
    console.log('[getDailyStreak] Event received:', {
      userId,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[getDailyStreak] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    try {
      const result = await this.contentService.getDailyStreak(userId);
      client.emit('getDailyStreak', { success: true, ...result });
      return result;
    } catch (error) {
      console.error('[getDailyStreak] Error occurred:', {
        userId,
        error: error.message,
        stack: error.stack,
      });
      client.emit('errorMessage', {
        message: error?.message || 'Failed to get daily streak',
      });
    }
  }

  // -------------------------------------------------------------
  // DEDUCT COINS
  // Client emits: deductCoins { amount? }
  // Deducts coins (default 5) from user's account
  // -------------------------------------------------------------
  @SubscribeMessage('deductCoins')
  async deductCoins(
    @ConnectedSocket() client: Socket,
    @MessageBody() data?: { amount?: number },
  ) {
    const userId = client.data.userId as string;
    console.log('[deductCoins] Event received:', {
      userId,
      data,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!userId) {
      console.log('[deductCoins] Error: Unauthorized - no userId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    try {
      // Default to 5 coins if amount is not provided or is invalid
      const amount = data?.amount !== undefined && data.amount > 0 ? data.amount : 5;
      const result = await this.contentService.deductCoins(userId, amount);
      client.emit('deductCoins', result);
      return result;
    } catch (error) {
      console.error('[deductCoins] Error occurred:', {
        userId,
        error: error.message,
        stack: error.stack,
        data,
      });
      client.emit('errorMessage', {
        message: error?.message || 'Failed to deduct coins',
      });
    }
  }

  // -------------------------------------------------------------
  // AUTO START GAME
  // Client emits: autostartgame { mode, member? }
  // mode is required: 'DUEL' or 'BRAWL'
  // mode = 'DUEL': member optional, game starts when 1 user accepts
  // mode = 'BRAWL': member required (3 or 4)
  //   - member = 3: game starts when 2 users accept (total 3 including inviter)
  //   - member = 4: game starts when 3 users accept (total 4 including inviter)
  // -------------------------------------------------------------
  @SubscribeMessage('autostartgame')
  async autostartgame(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { mode: 'DUEL' | 'BRAWL'; member?: number },
  ) {
    const inviterId = client.data.userId as string;
    console.log('[autostartgame] Event received:', {
      inviterId,
      body,
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    if (!inviterId) {
      console.log('[autostartgame] Error: Unauthorized - no inviterId');
      return client.emit('errorMessage', { message: 'Unauthorized' });
    }

    // Check if user is online
    const isOnline = await this.checkUserIsOnline(inviterId);
    console.log('[autostartgame] User online status:', { inviterId, isOnline });
    if (!isOnline) {
      console.log('[autostartgame] Error: User is not online');
      return client.emit('errorMessage', {
        message: 'You must be online to auto-start games. Please set your status to online.',
      });
    }

    try {
      // Validate mode is required
      if (!body?.mode) {
        console.log('[autostartgame] Error: mode is required');
        return client.emit('errorMessage', {
          message: 'mode is required',
        });
      }

      // Check if user already has an active auto-invite
      const normalizedInviterId = this.normalizeId(inviterId);
      if (!normalizedInviterId) {
        console.log('[autostartgame] Error: Invalid user ID:', { inviterId });
        return client.emit('errorMessage', {
          message: 'Invalid user ID',
        });
      }

      if (this.autoInviteStates.has(normalizedInviterId)) {
        console.log('[autostartgame] Error: Auto-invite already in progress:', {
          inviterId: normalizedInviterId,
        });
        return client.emit('errorMessage', {
          message: 'Auto-invite already in progress',
        });
      }

      // Validate mode value
      const mode = body.mode;
      console.log('[autostartgame] Validating mode:', { mode });
      if (mode !== 'DUEL' && mode !== 'BRAWL') {
        console.log('[autostartgame] Error: Invalid mode:', { mode });
        return client.emit('errorMessage', {
          message: 'mode must be either "DUEL" or "BRAWL"',
        });
      }

      // Validate member based on mode
      let requiredAcceptances = 1; // Default for DUEL
      const maxUsersToInvite = 6; // Always invite up to 6 users for both DUEL and BRAWL

      if (mode === 'DUEL') {
        // member is optional for DUEL, but if provided should be ignored
        requiredAcceptances = 1; // 1 user needs to accept
        console.log('[autostartgame] DUEL mode - required acceptances:', {
          requiredAcceptances,
        });
      } else if (mode === 'BRAWL') {
        // member is required for BRAWL
        if (!body?.member) {
          console.log('[autostartgame] Error: member required for BRAWL');
          return client.emit('errorMessage', {
            message: 'member is required when mode is "BRAWL"',
          });
        }

        if (body.member !== 3 && body.member !== 4) {
          console.log('[autostartgame] Error: Invalid member count for BRAWL:', {
            member: body.member,
          });
          return client.emit('errorMessage', {
            message: 'member must be either 3 or 4 when mode is "BRAWL"',
          });
        }

        // Calculate required acceptances
        // member = 3: need 2 acceptances (inviter + 2 = 3 total)
        // member = 4: need 3 acceptances (inviter + 3 = 4 total)
        requiredAcceptances = body.member - 1;
        console.log('[autostartgame] BRAWL mode - required acceptances:', {
          member: body.member,
          requiredAcceptances,
        });
      }

      // Get online users excluding the inviter
      console.log('[autostartgame] Getting online users:', { inviterId: normalizedInviterId });
      const onlineUsers = await this.contentService.getOnlineUsers();
      console.log('[autostartgame] Online users retrieved:', {
        totalOnlineUsers: onlineUsers.length,
      });

      // Filter users who are not in any room
      const availableUsers: typeof onlineUsers = [];
      for (const user of onlineUsers) {
        const userId = this.normalizeId(user._id);
        const userTyped = user as unknown as UserLean;
        const userType = userTyped?.userType;
        
        // Skip if invalid userId, is inviter, or not individual type
        if (!userId || userId === normalizedInviterId || userType !== 'individual') {
          continue;
        }

        // Check if user is already in a room
        const userRoom = this.contentService.getRoomByUserId(userId);
        if (userRoom) {
          console.log('[autostartgame] Skipping user already in room:', {
            userId,
            roomId: userRoom.roomId,
          });
          continue; // Skip users who are already in a room
        }

        availableUsers.push(user);
        
        // Stop if we have enough users
        if (availableUsers.length >= maxUsersToInvite) {
          break;
        }
      }

      console.log('[autostartgame] Available users to invite:', {
        availableUsers: availableUsers.length,
        maxUsersToInvite,
        userIds: availableUsers.map((u) => this.normalizeId(u._id)),
      });

      if (availableUsers.length === 0) {
        console.log('[autostartgame] Error: No online users available to invite');
        return client.emit('errorMessage', {
          message: 'No online users available to invite',
        });
      }

      // Generate a consistent roomId for all invites in this auto-invite session
      const sharedRoomId = randomUUID();
      console.log('[autostartgame] Generated shared roomId:', { sharedRoomId });

      // Create auto-invite state
      const autoInviteState: AutoInviteState = {
        inviterId: normalizedInviterId,
        invitedUserIds: [],
        currentIndex: 0,
        maxUsers: maxUsersToInvite,
        timeoutIds: [],
        isGameStarted: false,
        gameId: sharedRoomId, // Store the shared roomId
        mode: mode,
        member: body?.member,
        requiredAcceptances: requiredAcceptances,
        acceptedCount: 0,
      };

      this.autoInviteStates.set(normalizedInviterId, autoInviteState);
      console.log('[autostartgame] Auto-invite state created:', {
        inviterId: normalizedInviterId,
        mode,
        member: body?.member,
        requiredAcceptances,
        maxUsersToInvite,
        sharedRoomId,
      });

      // Start sequential invite process
      const userIdsToInvite = availableUsers
        .map((u) => this.normalizeId(u._id))
        .filter((id): id is string => id !== null);

      console.log('[autostartgame] Starting sequential invite process:', {
        inviterId: normalizedInviterId,
        userIdsToInvite,
        totalUsers: userIdsToInvite.length,
        sharedRoomId,
        mode,
      });

      this.sendSequentialInvites(
        normalizedInviterId,
        userIdsToInvite,
        0,
        sharedRoomId,
        mode,
      );

      console.log('[autostartgame] Emitting autostartgameResponse:', {
        inviterId: normalizedInviterId,
        mode,
        member: body?.member,
        requiredAcceptances,
        totalUsers: availableUsers.length,
      });

      client.emit('autostartgameResponse', {
        success: true,
        message: 'Auto-invite started',
        mode: mode,
        member: body?.member,
        requiredAcceptances: requiredAcceptances,
        totalUsers: availableUsers.length,
      });
      console.log('[autostartgame] Auto-invite process started successfully');
    } catch (error) {
      console.error('[autostartgame] Error occurred:', {
        inviterId,
        error: error.message,
        stack: error.stack,
        body,
      });
      client.emit('errorMessage', {
        message: error?.message || 'Failed to start auto-invite',
      });
    }
  }

  // -------------------------------------------------------------
  // SEND SEQUENTIAL INVITES
  // Sends invites one by one with 15 second intervals
  // -------------------------------------------------------------
  private async sendSequentialInvites(
    inviterId: string,
    userIds: string[],
    currentIndex: number,
    roomId?: string,
    mode: 'DUEL' | 'BRAWL' = 'DUEL',
  ) {
    console.log('[sendSequentialInvites] Processing invite:', {
      inviterId,
      currentIndex,
      totalUsers: userIds.length,
      roomId,
      mode,
      timestamp: new Date().toISOString(),
    });

    const autoInviteState = this.autoInviteStates.get(inviterId);

    if (!autoInviteState) {
      console.log('[sendSequentialInvites] Auto-invite state not found, cancelled:', {
        inviterId,
      });
      return; // Auto-invite was cancelled
    }

    // If game already started, stop sending invites
    if (autoInviteState.isGameStarted) {
      console.log('[sendSequentialInvites] Game already started, stopping invites:', {
        inviterId,
        gameId: autoInviteState.gameId,
      });
      this.autoInviteStates.delete(inviterId);
      return;
    }

    // Check if we've reached the required number of acceptances
    if (autoInviteState.acceptedCount >= autoInviteState.requiredAcceptances) {
      console.log('[sendSequentialInvites] Required acceptances reached, stopping invites:', {
        inviterId,
        acceptedCount: autoInviteState.acceptedCount,
        requiredAcceptances: autoInviteState.requiredAcceptances,
      });
      // Game should have started, stop sending invites
      this.autoInviteStates.delete(inviterId);
      return;
    }

    // If we've sent all 6 invites and not enough users accepted, throw error
    if (currentIndex >= userIds.length || currentIndex >= autoInviteState.maxUsers) {
      console.log('[sendSequentialInvites] Reached max invites limit:', {
        inviterId,
        currentIndex,
        totalUsers: userIds.length,
        maxUsers: autoInviteState.maxUsers,
        acceptedCount: autoInviteState.acceptedCount,
        requiredAcceptances: autoInviteState.requiredAcceptances,
      });
      // Check if enough users have accepted
      if (autoInviteState.acceptedCount < autoInviteState.requiredAcceptances) {
        console.log('[sendSequentialInvites] Not enough acceptances, clearing timeouts:', {
          inviterId,
          acceptedCount: autoInviteState.acceptedCount,
          requiredAcceptances: autoInviteState.requiredAcceptances,
        });
        // Clear all timeouts
        autoInviteState.timeoutIds.forEach((timeoutId) => clearTimeout(timeoutId));
        this.autoInviteStates.delete(inviterId);

        const inviterSocket = this.userSockets.get(inviterId);
        if (inviterSocket) {
          const modeText = mode === 'DUEL' ? 'DUEL' : `BRAWL (${autoInviteState.member} members)`;
          const requiredText = mode === 'DUEL' ? '1 user' : `${autoInviteState.requiredAcceptances} users`;
          const errorMessage = `Not enough users accepted the invite. Required: ${requiredText}, Accepted: ${autoInviteState.acceptedCount} after ${autoInviteState.maxUsers} attempts for ${modeText}`;
          console.log('[sendSequentialInvites] Emitting error to inviter:', {
            inviterId,
            errorMessage,
          });
          inviterSocket.emit('errorMessage', {
            message: errorMessage,
          });
        }
      }
      return;
    }

    const targetUserId = userIds[currentIndex];
    if (!targetUserId) {
      console.log('[sendSequentialInvites] No target user at index, moving to next:', {
        inviterId,
        currentIndex,
      });
      // Move to next user
      const timeoutId = setTimeout(() => {
        this.sendSequentialInvites(inviterId, userIds, currentIndex + 1, roomId, mode);
      }, 15000);
      autoInviteState.timeoutIds.push(timeoutId);
      return;
    }

    // Use the shared roomId from autoInviteState if available, otherwise use passed roomId
    const sharedRoomId = autoInviteState.gameId || roomId;

    console.log('[sendSequentialInvites] Sending invite to user:', {
      inviterId,
      targetUserId,
      currentIndex,
      sharedRoomId,
      mode,
    });

    // Send invite to current user
    try {
      const invite = await this.contentService.inviteUserToGame(inviterId, {
        userId: targetUserId,
        gameMode: mode,
        gameId: sharedRoomId, // Use shared roomId for all invites
      });

      console.log('[sendSequentialInvites] Invite created successfully:', {
        inviterId,
        targetUserId,
        invite,
      });

      // Get inviter's name for the response
      let inviterName = '';
      try {
        const inviter = await this.usersService.findById(inviterId);
        const inviterTyped = inviter as unknown as UserLean;
        inviterName = inviterTyped?.name || inviterTyped?.username || '';
      } catch (error) {
        console.warn('[sendSequentialInvites] Failed to get inviter name:', {
          inviterId,
          error: error.message,
        });
        inviterName = '';
      }

      // Emit inviteUserResponse only to the invited user (not all users)
      const invitedUserSocket = this.userSockets.get(targetUserId);
      if (invitedUserSocket) {
        console.log('[sendSequentialInvites] Emitting inviteUserResponse to invited user:', {
          targetUserId,
          socketId: invitedUserSocket.id,
          inviterName,
        });
        invitedUserSocket.emit('inviteUserResponse', {
          success: true,
          invite,
          invites: [invite], // Always return as array for consistency
          inviterName: inviterName,
        });
      } else {
        console.warn('[sendSequentialInvites] Invited user socket not found:', {
          targetUserId,
          availableSockets: Array.from(this.userSockets.keys()),
        });
      }

      autoInviteState.invitedUserIds.push(targetUserId);
      console.log('[sendSequentialInvites] Added user to invited list:', {
        inviterId,
        targetUserId,
        totalInvited: autoInviteState.invitedUserIds.length,
      });

      // Set timeout to move to next user if not accepted in 15 seconds
      const timeoutId = setTimeout(() => {
        console.log('[sendSequentialInvites] Timeout reached, checking if should continue:', {
          inviterId,
          currentIndex,
          acceptedCount: autoInviteState.acceptedCount,
          requiredAcceptances: autoInviteState.requiredAcceptances,
        });
        // Check if game started or enough users accepted before moving to next
        const state = this.autoInviteStates.get(inviterId);
        if (state && !state.isGameStarted) {
          // Only continue if we haven't reached required acceptances
          if (state.acceptedCount < state.requiredAcceptances) {
            console.log('[sendSequentialInvites] Continuing to next user:', {
              inviterId,
              nextIndex: currentIndex + 1,
            });
            this.sendSequentialInvites(inviterId, userIds, currentIndex + 1, sharedRoomId, mode);
          } else {
            console.log('[sendSequentialInvites] Required acceptances reached, not continuing:', {
              inviterId,
              acceptedCount: state.acceptedCount,
              requiredAcceptances: state.requiredAcceptances,
            });
          }
        } else {
          console.log('[sendSequentialInvites] Game started or state not found, not continuing:', {
            inviterId,
            isGameStarted: state?.isGameStarted,
            hasState: !!state,
          });
        }
      }, 15000);

      autoInviteState.timeoutIds.push(timeoutId);
      autoInviteState.currentIndex = currentIndex + 1;
      console.log('[sendSequentialInvites] Timeout set for next invite:', {
        inviterId,
        currentIndex: autoInviteState.currentIndex,
        totalTimeouts: autoInviteState.timeoutIds.length,
      });
    } catch (error) {
      console.error('[sendSequentialInvites] Error sending invite, moving to next user:', {
        inviterId,
        targetUserId,
        currentIndex,
        error: error.message,
        stack: error.stack,
      });
      // If invite fails, move to next user immediately
      const sharedRoomId = autoInviteState.gameId || roomId;
      const timeoutId = setTimeout(() => {
        this.sendSequentialInvites(inviterId, userIds, currentIndex + 1, sharedRoomId, mode);
      }, 100);
      autoInviteState.timeoutIds.push(timeoutId);
    }
  }
}