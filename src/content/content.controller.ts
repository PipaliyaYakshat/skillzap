import {
  Controller, Get, Post, Body, Patch, Param, Delete, BadRequestException, Query, UseGuards, UseInterceptors, UploadedFile, Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { type Express, type Request } from 'express';
import { ContentService } from './content.service';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { MoveTopicsDto } from './dto/move-topics.dto';
import { DeckAIService } from './deck-ai.service';
import { UpdateDeckNameDto } from './dto/update-deck-name.dto';
import {
  ApiBody, ApiBearerAuth, ApiConsumes, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import { ListContentQueryDto } from './dto/list-content-query.dto';
import { LibraryQueryDto, LibraryFilter } from './dto/library-query.dto';
import { FlexibleAuthGuard } from './gured/flexible-auth.guard';
import { multerFileOptions } from '../common/multer.service';
import { JwtAuthGuard } from '../auth/lib/jwt-auth.guard';
import { Roles } from '../auth/lib/roles.decorator';
import { RolesGuard } from '../auth/lib/roles.guard';

@ApiTags('Content')
// @UseGuards(FlexibleAuthGuard)
@Controller('content')
export class ContentController {
  constructor(
    private readonly contentService: ContentService,
    private readonly deckAIService: DeckAIService,
  ) { }

  @Post()
  @ApiOperation({
    summary: 'Create new content',
    description: 'Creates a new content item. Either userId or deviceId is required.',
  })
  create(@Body() createContentDto: CreateContentDto) {
    return this.contentService.create(createContentDto);
  }

  @Post('upload')
  @UseGuards(FlexibleAuthGuard)
  @ApiOperation({
    summary: 'Upload a file',
    description: 'Uploads a file and creates content from it. Supports various file types (PDF, images, documents, etc.).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload a file along with additional content metadata',
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', multerFileOptions))
  uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request & { user?: Record<string, any> },
  ) {
    return this.contentService.uploadFile(req.user, file);
  }

  @Post('/generate')
  @UseGuards(JwtAuthGuard)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Generate a new deck (or add topics to an existing one)',
    description:
      'Creates a deck with topics/subtopics from provided text or uploaded file (PDF, images, etc.). If deckId is provided, topics are appended to that deck. File upload takes precedence over text input.',
  })
  @UseInterceptors(FileInterceptor('file', multerFileOptions))
  @ApiBody({
    description:
      'Provide either source text OR upload a file (PDF, images, etc.) along with category. Optionally include deckId to append topics to an existing deck.',
    schema: {
      type: 'object',
      required: ['category'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Upload file (PDF, images, documents, etc.) - takes precedence over text',
        },
        text: {
          type: 'string',
          description: 'Source text or file path (required if file is not provided)',
        },
        category: { type: 'string', description: 'Deck category' },
        deckId: {
          type: 'string',
          description: 'Existing deck ID to append topics to (optional)',
        },
      },
      example: {
        text: 'Intro to HTTP and REST...',
        category: 'Web Development',
        deckId: '67501b23842d45d1c3d9f91a',
      },
    },
  })
  async createDeck(
    @Req() req: Request & { user?: Record<string, any> },
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: {
      text?: string;
      category?: string;
      deckId?: string;
    },
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    const { text, category, deckId } = body ?? {};

    if (!userId) {
      throw new BadRequestException('User authentication required');
    }
    if (!category) {
      throw new BadRequestException('category is required');
    }
    if (!file && !text) {
      throw new BadRequestException(
        'Either file upload or text is required',
      );
    }

    // If file is uploaded, use file path; otherwise use text
    const inputSource = file ? file.path : text!;

    return this.deckAIService.generateDeck(
      userId,
      inputSource,
      category,
      deckId,
    );
  }

  @Post('/subtopic/:id/start')
  @ApiOperation({
    summary: 'Start single player game',
    description:
      'Generates 9 MCQ questions using AI based on subtopic and difficulty, then creates a game instance.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'SubTopic ID',
    example: '67501b23842d45d1c3d9f91a',
  })
  @ApiQuery({
    name: 'difficulty',
    required: false,
    enum: ['easy', 'medium', 'hard'],
    description: 'Difficulty level for MCQ questions',
    example: 'medium',
  })
  @ApiResponse({
    status: 201,
    description: 'Game created successfully',
    schema: {
      example: {
        message: 'Game created successfully',
        gameId: 'a231bc23-19cc-4b11-aa3e-4fab89be71c7',
        questions: [
          {
            question: 'What is JavaScript primarily used for?',
            options: [
              'Styling web pages',
              'Structuring web pages',
              'Adding interactivity',
              'Managing servers',
            ],
            correctAnswer: 'Adding interactivity',
          },
        ],
      },
    },
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['userId'],
      properties: {
        userId: {
          type: 'string',
          description: 'User id whose sequence progress will be validated',
        },
      },
    },
  })
  async singelPlayCreateGame(
    @Param('id') subTopicId: string,
    @Query('difficulty') difficulty: 'easy' | 'medium' | 'hard' = 'easy',
    @Body('userId') userId?: string,
  ) {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }
    return this.contentService.singlePlayCreateGame(
      userId,
      subTopicId,
      difficulty,
    );
  }

  @Get()
  @ApiOperation({
    summary: 'Get all content with filters',
    description: 'Retrieves all content items with optional filtering by userId, deviceId, contentType, processingStatus, and isProcessed.',
  })
  findAll(@Query() query: ListContentQueryDto) {
    return this.contentService.findAll(query);
  }

  @Get('leaderboard')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get leaderboard',
    description:
      'Get leaderboard of users sorted by highest points. Optionally filter by level name (e.g., Awakened, Initiators, Pathfinders). Returns paginated, simplified user details.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 10, max: 100)',
    example: 10,
  })
  @ApiQuery({
    name: 'levelName',
    required: false,
    type: String,
    description:
      'Optional level name to filter users by (e.g., Awakened, Initiators, Pathfinders, Builders, Achievers, Catalysts, Trailblazers, Luminaries, Visionaries, Conquerors, Innovators, Mavericks, Ascendants, Navigators, Transformers, Champions, Guardians, Architects, Vanguards, Legends). Case-insensitive.',
    example: 'Trailblazers',
  })
  async getLeaderboard(
    @Req() req: Request & { user?: Record<string, any> },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('levelName') levelName?: string,
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }

    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 10;

    if (isNaN(pageNumber) || pageNumber < 1) {
      throw new BadRequestException('Page must be a positive number');
    }
    if (isNaN(limitNumber) || limitNumber < 1) {
      throw new BadRequestException('Limit must be a positive number');
    }

    return this.contentService.getLeaderboard(
      userId,
      pageNumber,
      limitNumber,
      levelName,
    );
  }

  @Get('deck/me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get all decks created by the authenticated user',
    description: 'Returns all decks created by the user who is authenticated via JWT token.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of user decks retrieved successfully',
  })
  async getMyDecks(
    @Req() req: Request & { user?: Record<string, any> },
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }
    return this.contentService.getMyDecks(userId);
  }

  @Patch('deck/:deckId/name')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Update deck name',
    description: 'Updates only the name of a deck owned by the authenticated user.',
  })
  @ApiParam({
    name: 'deckId',
    type: String,
    description: 'Deck ID to update',
    example: '67501b23842d45d1c3d9f91a',
  })
  @ApiBody({ type: UpdateDeckNameDto })
  @ApiResponse({
    status: 200,
    description: 'Deck name updated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid input or unauthorized',
  })
  @ApiResponse({
    status: 404,
    description: 'Deck not found',
  })
  async updateDeckName(
    @Req() req: Request & { user?: Record<string, any> },
    @Param('deckId') deckId: string,
    @Body() body: UpdateDeckNameDto,
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }

    return this.contentService.updateDeckName(deckId, userId, body.name);
  }

  @Get('topic/:topicId')
  @ApiOperation({
    summary: 'Get topic by ID with all subtopics',
    description:
      'Returns complete topic data including all subtopics populated.',
  })
  @ApiParam({
    name: 'topicId',
    type: String,
    description: 'Topic ID to retrieve',
    example: '67501b23842d45d1c3d9f91a',
  })
  @ApiResponse({
    status: 200,
    description: 'Topic retrieved successfully with all subtopics',
    schema: {
      example: {
        _id: '67501b23842d45d1c3d9f91a',
        title: 'Sample Topic',
        description: 'Topic description',
        subTopics: [
          {
            _id: '67501b23842d45d1c3d9f91b',
            title: 'Sample Subtopic',
            description: 'Subtopic description',
            topicId: '67501b23842d45d1c3d9f91a',
            questions: [],
            questionsAsked: [],
            moreDetailsRequests: [],
          },
        ],
        contentIds: [],
        metadata: {},
        userPercentages: {},
        details: [],
        questions: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Topic not found',
  })
  async getTopicById(@Param('topicId') topicId: string) {
    return this.contentService.getTopicById(topicId);
  }

  @Get('subtopic/:subTopicId')
  @UseGuards(FlexibleAuthGuard)
  @ApiOperation({
    summary: 'Get subtopic by ID',
    description:
      'Returns complete subtopic data. If user is authenticated, only shows userPercentages, questionsAsked, and moreDetailsRequests for the authenticated user.',
  })
  @ApiParam({
    name: 'subTopicId',
    type: String,
    description: 'Subtopic ID to retrieve',
    example: '67501b23842d45d1c3d9f91a',
  })
  @ApiResponse({
    status: 200,
    description: 'Subtopic retrieved successfully',
    schema: {
      example: {
        _id: '67501b23842d45d1c3d9f91a',
        title: 'Sample Subtopic',
        description: 'Subtopic description',
        topicId: '67501b23842d45d1c3d9f91b',
        contentIds: [],
        metadata: {},
        questions: [],
        questionsAsked: [],
        moreDetailsRequests: [],
        userPercentages: {},
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Subtopic not found',
  })
  async getSubTopicById(
    @Param('subTopicId') subTopicId: string,
    @Req() req: Request & { user?: Record<string, any> },
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    return this.contentService.getSubTopicById(subTopicId, userId);
  }

  @Get('topic/:topicId/progress')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get user topic progress',
    description:
      'Returns the authenticated user\'s progress for a specific topic. If no progress exists, it will be created with default values.',
  })
  @ApiParam({
    name: 'topicId',
    type: String,
    description: 'Topic ID to get progress for',
    example: '67501b23842d45d1c3d9f91a',
  })
  @ApiResponse({
    status: 200,
    description: 'Topic progress retrieved successfully',
    schema: {
      example: {
        _id: '67501b23842d45d1c3d9f91a',
        userId: '67501b23842d45d1c3d9f91b',
        topicId: '67501b23842d45d1c3d9f91c',
        completedSubTopicIds: ['67501b23842d45d1c3d9f91d', '67501b23842d45d1c3d9f91e'],
        completedCycles: 1,
        lastCycleCompletedAt: '2024-01-01T00:00:00.000Z',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid topic ID or user authentication required',
  })
  @ApiResponse({
    status: 404,
    description: 'Topic not found',
  })
  async getTopicProgress(
    @Param('topicId') topicId: string,
    @Req() req: Request & { user?: Record<string, any> },
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }
    return this.contentService.getUserTopicProgress(userId, topicId);
  }

  @Post('move-topics')
  @UseGuards(FlexibleAuthGuard)
  @ApiOperation({
    summary: 'Move topics from one deck to another',
    description:
      'Move topics (along with their subtopics) from their current deck(s) to a new deck. Topics will be removed from old deck(s) and added to the destination deck. User can only move topics from and to decks they created.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['topicIds', 'deckId'],
      properties: {
        topicIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of topic IDs to move',
          example: ['67501b23842d45d1c3d9f91a', '67501b23842d45d1c3d9f91b'],
        },
        deckId: {
          type: 'string',
          description: 'Destination deck ID where topics will be moved',
          example: '67501b23842d45d1c3d9f91c',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Topics moved successfully',
    schema: {
      example: {
        message: 'Topics moved successfully',
        movedTopics: 2,
        movedSubTopics: 5,
        destinationDeckId: '67501b23842d45d1c3d9f91c',
        topicIds: ['67501b23842d45d1c3d9f91a', '67501b23842d45d1c3d9f91b'],
        subTopicIds: [
          '67501b23842d45d1c3d9f91d',
          '67501b23842d45d1c3d9f91e',
          '67501b23842d45d1c3d9f91f',
        ],
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - User can only move topics from/to decks they created',
  })
  async moveTopics(
    @Req() req: Request & { user?: Record<string, any> },
    @Body() moveTopicsDto: MoveTopicsDto,
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }

    const { topicIds, deckId } = moveTopicsDto;
    return this.contentService.moveTopics(topicIds, deckId, userId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get content by ID',
    description: 'Retrieves a single content item by its ID. The ID must be a valid MongoDB ObjectId.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Content ID to retrieve',
    example: '67501b23842d45d1c3d9f91a',
  })
  @ApiResponse({
    status: 200,
    description: 'Content retrieved successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid content ID format',
  })
  @ApiResponse({
    status: 404,
    description: 'Content not found',
  })
  findOne(@Param('id') id: string) {
    return this.contentService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update content by ID',
    description: 'Updates an existing content item by its ID. The ID must be a valid MongoDB ObjectId.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Content ID to update',
    example: '67501b23842d45d1c3d9f91a',
  })
  @ApiBody({ type: UpdateContentDto })
  @ApiResponse({
    status: 200,
    description: 'Content updated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid content ID format or bad request',
  })
  @ApiResponse({
    status: 404,
    description: 'Content not found',
  })
  update(@Param('id') id: string, @Body() updateContentDto: UpdateContentDto) {
    return this.contentService.update(id, updateContentDto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete content by ID',
    description: 'Permanently deletes a content item by its ID. The ID must be a valid MongoDB ObjectId.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Content ID to delete',
    example: '67501b23842d45d1c3d9f91a',
  })
  @ApiResponse({
    status: 200,
    description: 'Content deleted successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid content ID format',
  })
  @ApiResponse({
    status: 404,
    description: 'Content not found',
  })
  remove(@Param('id') id: string) {
    return this.contentService.remove(id);
  }

  @Post('deck/request-public')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Request public access for a deck',
    description: 'User can request to make their deck public. Status will be set to pending and isPublic will be set to true.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['deckId'],
      properties: {
        deckId: {
          type: 'string',
          description: 'Deck ID to request public access for',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Public access request submitted successfully',
  })
  async requestPublicAccess(
    @Req() req: Request & { user?: Record<string, any> },
    @Body('deckId') deckId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }
    if (!deckId) {
      throw new BadRequestException('deckId is required');
    }
    return this.contentService.requestPublicAccess(userId, deckId);
  }

  @Get('deck/library')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get library decks with pagination',
    description: 'Get decks based on filter. Private: shows user\'s decks with isPublic=false and status=pending. Public: shows all decks with isPublic=true and status=approve.',
  })
  @ApiQuery({
    name: 'filter',
    required: true,
    enum: LibraryFilter,
    description: 'Filter type: private or public',
    example: 'public',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 10)',
    example: 10,
  })
  @ApiQuery({
    name: 'category',
    required: false,
    type: String,
    description: 'Filter decks by category',
    example: 'Science',
  })
  @ApiResponse({
    status: 200,
    description: 'Library decks retrieved successfully with pagination',
    schema: {
      example: {
        data: [
          {
            _id: '67501b23842d45d1c3d9f91a',
            name: 'Sample Deck',
            description: 'Sample description',
            isPublic: true,
            status: 'approve',
            userId: '67501b23842d45d1c3d9f91b',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        ],
        pagination: {
          page: 1,
          limit: 10,
          total: 50,
          totalPages: 5,
          hasNextPage: true,
          hasPrevPage: false,
        },
      },
    },
  })
  async getLibrary(
    @Req() req: Request & { user?: Record<string, any> },
    @Query() query: LibraryQueryDto,
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId || null;
    const filter = query.filter || 'public';
    const page = query.page ? parseInt(query.page, 10) : 1;
    const limit = query.limit ? parseInt(query.limit, 10) : 10;
    const category = query.category;

    if (page < 1) {
      throw new BadRequestException('Page must be greater than 0');
    }
    if (limit < 1) {
      throw new BadRequestException('Limit must be greater than 0');
    }

    return this.contentService.getLibrary(userId, filter, page, limit, category);
  }

  @Get('deck/:deckId')
  @ApiOperation({
    summary: 'Get deck by ID with all topics',
    description:
      'Returns complete deck data including all topics (without subtopics). Supports pagination for topics.',
  })
  @ApiParam({
    name: 'deckId',
    type: String,
    description: 'Deck ID to retrieve',
    example: '67501b23842d45d1c3d9f91a',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of topics per page (default: 10, max: 100)',
    example: 10,
  })
  @ApiResponse({
    status: 200,
    description: 'Deck retrieved successfully with all topics',
    schema: {
      example: {
        _id: '67501b23842d45d1c3d9f91a',
        name: 'Sample Deck',
        description: 'Sample description',
        userId: '67501b23842d45d1c3d9f91b',
        contentIds: ['67501b23842d45d1c3d9f91c'],
        isPublic: true,
        status: 'approve',
        category: 'Science',
        topics: [
          {
            _id: '67501b23842d45d1c3d9f91c',
            title: 'Sample Topic',
            description: 'Topic description',
            contentIds: [],
            userPercentages: {},
            details: [],
            questions: [],
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
        pagination: {
          page: 1,
          limit: 10,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Deck not found',
  })
  async getDeckById(
    @Param('deckId') deckId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 10;

    if (isNaN(pageNumber) || pageNumber < 1) {
      throw new BadRequestException('Page must be a positive number');
    }

    if (isNaN(limitNumber) || limitNumber < 1) {
      throw new BadRequestException('Limit must be a positive number');
    }

    return this.contentService.getDeckById(deckId, pageNumber, limitNumber);
  }

  @Post('subtopic/:subTopicId/ask-question')
  @UseGuards(FlexibleAuthGuard)
  @ApiOperation({
    summary: 'Ask a question about a subtopic',
    description: 'User can ask a question about a subtopic and get an AI-generated answer. The question and answer will be stored in the subtopic.',
  })
  @ApiParam({
    name: 'subTopicId',
    type: String,
    description: 'SubTopic ID to ask question about',
    example: '67501b23842d45d1c3d9f91a',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['question'],
      properties: {
        question: {
          type: 'string',
          description: 'The question to ask',
          example: 'What is the main concept of this subtopic?',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Question answered successfully',
    schema: {
      example: {
        question: 'What is the main concept of this subtopic?',
        answer: 'The main concept is...',
        subTopicId: '67501b23842d45d1c3d9f91a',
        askedAt: '2024-01-01T00:00:00.000Z',
      },
    },
  })
  async askQuestion(
    @Param('subTopicId') subTopicId: string,
    @Req() req: Request & { user?: Record<string, any> },
    @Body() body: { question: string },
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    const { question } = body;

    if (!subTopicId) {
      throw new BadRequestException('subTopicId is required');
    }
    if (!question || !question.trim()) {
      throw new BadRequestException('question is required');
    }

    return this.contentService.askQuestion(
      subTopicId,
      question.trim(),
      userId,
    );
  }

  @Post('subtopic/:subTopicId/more-details')
  @UseGuards(FlexibleAuthGuard)
  @ApiOperation({
    summary: 'Get more details about a subtopic',
    description: 'User can request more detailed information about a subtopic. An AI-generated detailed explanation will be provided and stored in the subtopic.',
  })
  @ApiParam({
    name: 'subTopicId',
    type: String,
    description: 'SubTopic ID to get more details about',
    example: '67501b23842d45d1c3d9f91a',
  })
  @ApiResponse({
    status: 200,
    description: 'More details retrieved successfully',
    schema: {
      example: {
        subTopicId: '67501b23842d45d1c3d9f91a',
        answer: 'Detailed explanation of the subtopic...',
        requestedAt: '2024-01-01T00:00:00.000Z',
      },
    },
  })
  async getMoreDetails(
    @Param('subTopicId') subTopicId: string,
    @Req() req: Request & { user?: Record<string, any> },
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;

    if (!subTopicId) {
      throw new BadRequestException('subTopicId is required');
    }

    return this.contentService.getMoreDetails(subTopicId, userId);
  }

  @Delete('deck/:deckId/delete-topics')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Delete topics (and their subtopics) from a deck',
    description:
      'Permanently deletes the provided topic IDs from the specified deck. Removes the topic IDs from deck.contentIds and deletes the topics and all their subtopics from the database. Only the deck owner can perform this action.',
  })
  @ApiParam({
    name: 'deckId',
    type: String,
    description: 'Deck ID containing the topics to delete',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['topicIds'],
      properties: {
        topicIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of topic IDs to delete permanently',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Topics and subtopics deleted successfully',
  })
  async deleteTopics(
    @Req() req: Request & { user?: Record<string, any> },
    @Param('deckId') deckId: string,
    @Body('topicIds') topicIds: string[],
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }
    return this.contentService.deleteTopics(deckId, topicIds, userId);
  }

  @Delete('deck/:deckId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Delete a deck along with all its topics and subtopics',
    description:
      'Permanently deletes a deck along with all its topics and subtopics from the database. Only the deck owner (user who created the deck) can perform this action.',
  })
  @ApiParam({
    name: 'deckId',
    type: String,
    description: 'Deck ID to delete',
    example: '67501b23842d45d1c3d9f91a',
  })
  @ApiResponse({
    status: 200,
    description: 'Deck deleted successfully along with all topics and subtopics',
    schema: {
      example: {
        success: true,
        deletedDeck: '67501b23842d45d1c3d9f91a',
        deletedTopics: 5,
        deletedSubTopics: 12,
        message: 'Deck deleted successfully along with all topics and subtopics',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Invalid deck ID, user authentication required, or user is not the deck owner',
  })
  @ApiResponse({
    status: 404,
    description: 'Deck not found',
  })
  async deleteDeck(
    @Req() req: Request & { user?: Record<string, any> },
    @Param('deckId') deckId: string,
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }
    return this.contentService.deleteDeck(deckId, userId);
  }

  @Patch('user/toggle-online-status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Toggle user online status',
    description:
      'Toggles the authenticated user\'s online status (true -> false, false -> true). Returns the user object with the new status after toggling.',
  })
  @ApiResponse({
    status: 200,
    description: 'User online status toggled successfully',
    schema: {
      example: {
        _id: '67501b23842d45d1c3d9f91a',
        name: 'John Doe',
        email: 'john@example.com',
        isOnline: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'User authentication required',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  async toggleUserOnlineStatus(
    @Req() req: Request & { user?: Record<string, any> },
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }
    return this.contentService.toggleUserOnlineStatus(userId);
  }

  @Get('users/online')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get all online users',
    description:
      'Returns a list of all users who are currently online (isOnline: true) and active (isActive: true). Results are sorted by lastSeen in descending order (most recently seen first).',
  })
  @ApiResponse({
    status: 200,
    description: 'List of online users retrieved successfully',
    schema: {
      example: [
        {
          _id: '67501b23842d45d1c3d9f91a',
          name: 'John Doe',
          email: 'john@example.com',
          profileImage: 'https://example.com/profile.jpg',
          isOnline: true,
          lastSeen: '2024-01-01T12:00:00.000Z',
        },
        {
          _id: '67501b23842d45d1c3d9f91b',
          name: 'Jane Smith',
          email: 'jane@example.com',
          profileImage: null,
          isOnline: true,
          lastSeen: '2024-01-01T11:30:00.000Z',
        },
      ],
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User authentication required',
  })
  async getOnlineUsers() {
    return this.contentService.getOnlineUsers();
  }
}
