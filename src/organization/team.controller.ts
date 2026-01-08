import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  HttpException,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TeamService } from './team.service';

import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { MakeUserAdminDto } from './dto/make-user-admin.dto';
import { CreateTeamDto } from './dto/create-team.dto';
import { AddMemberToTeamDto } from './dto/add-member-to-team.dto';
import { RemoveMemberFromTeamDto } from './dto/remove-member-from-team.dto';
import { MoveMemberToTeamDto } from './dto/move-member-to-team.dto';
import { GetTeamMembersDto } from './dto/get-team-members.dto';
import { RemoveAdminDto } from './dto/remove-admin.dto';
import { MyDecksQueryDto } from './dto/my-decks-query.dto';
import { UpdateDeckNameDto } from '../content/dto/update-deck-name.dto';
import {
  ApiTags,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiParam,
  ApiQuery,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/lib/jwt-auth.guard';
import { TeamOnlyGuard } from './guards/team-only.guard';
import { TeamRoleGuard } from './guards/team-role.guard';
import { RolesGuard } from '../auth/lib/roles.guard';
import { Roles } from '../auth/lib/roles.decorator';
import { multerOrganizationLogoOptions } from '../common/multer.service';
import { type Request } from 'express';
import { USER_ROLE, USER_TYPE, STATUS_UPDATE } from 'src/common/enum';

// Type for authenticated user object
type AuthUser = {
  id?: string;
  _id?: string;
  userId?: string;
  [key: string]: unknown;
};

@ApiTags('Team Controller')
@Controller('organization')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Post('create')
  @UseGuards(TeamOnlyGuard)
  @UseInterceptors(
    FileInterceptor('organizationLogo', multerOrganizationLogoOptions),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Create organization (superAdmin only)',
    description:
      'Creates a new organization with a name and logo. Only users with superAdmin role can create organizations.',
  })
  @ApiBody({
    description: 'Create organization with logo file upload',
    schema: {
      type: 'object',
      required: ['organizationName', 'organizationLogo'],
      properties: {
        organizationName: {
          type: 'string',
          example: 'My Organization',
          description: 'Name of the organization',
        },
        organizationLogo: {
          type: 'string',
          format: 'binary',
          description: 'Logo image file for the organization',
        },
      },
    },
  })
  async createOrganization(
    @Body() createOrganizationDto: CreateOrganizationDto,
    @UploadedFile() organizationLogo: Express.Multer.File,
    @Req() req: Request & { user?: AuthUser },
  ) {
    if (!organizationLogo) {
      throw new BadRequestException('Organization logo is required');
    }
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }
    return this.teamService.createOrganization(
      createOrganizationDto,
      organizationLogo,
      userId,
    );
  }

  @Get('my-organizations')
  @UseGuards(TeamOnlyGuard)
  @ApiOperation({
    summary: 'Get organizations created by superAdmin',
    description:
      'Retrieves all organizations created by the authenticated superAdmin user.',
  })
  @ApiResponse({
    status: 200,
    description: 'Organizations retrieved successfully',
  })
  async getOrganization(@Req() req: Request & { user?: AuthUser }) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }
    return this.teamService.getOrganization(userId);
  }

  // @Get('dashboard')
  // @ApiOperation({ summary: 'Get dashboard data (organizations, teams, members)' })
  // async getDashboard(@Req() req: Request & { user?: AuthUser }) {
  //   const userId = req.user?.id;
  //   if (!userId) {
  //     throw new BadRequestException('User authentication required');
  //   }
  //   return this.teamService.getDashboardOverview(userId);
  // }

  @Get('all')
  @UseGuards(RolesGuard)
  @Roles(USER_ROLE[0])
  @ApiOperation({
    summary: 'Get all organizations (admin role only)',
    description:
      'Retrieves all organizations in the system. Only accessible to users with admin role.',
  })
  @ApiResponse({
    status: 200,
    description: 'All organizations retrieved successfully',
  })
  async getAllOrganization(@Req() req: Request & { user?: AuthUser }) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }
    return this.teamService.getAllOrganization(userId);
  }

  @Put(':id')
  @UseInterceptors(
    FileInterceptor('organizationLogo', multerOrganizationLogoOptions),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Update organization (creator only)',
    description:
      'Updates an existing organization. Only the creator of the organization can update it. Logo upload is optional.',
  })
  @ApiParam({ name: 'id', description: 'Organization ID' })
  @ApiBody({
    description: 'Update organization with optional logo file upload',
    schema: {
      type: 'object',
      properties: {
        organizationName: {
          type: 'string',
          example: 'Updated Organization Name',
          description: 'Name of the organization',
        },
        organizationLogo: {
          type: 'string',
          format: 'binary',
          description: 'Logo image file for the organization (optional)',
        },
      },
    },
  })
  async updateOrganization(
    @Param('id') id: string,
    @Body() updateOrganizationDto: UpdateOrganizationDto,
    @UploadedFile() organizationLogo: Express.Multer.File | undefined,
    @Req() req: Request & { user?: AuthUser },
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }
    return this.teamService.updateOrganization(
      id,
      updateOrganizationDto,
      organizationLogo,
      userId,
    );
  }

  @Get('teams')
  @ApiOperation({
    summary: 'Get all teams for user organizations with members',
    description:
      'Retrieves all teams from organizations where the authenticated user is a member (superAdmin, admin, or team member). Returns teams with their member data including points and rankings. Optionally filter members by status (approved/pending) using the status query parameter. Optionally filter teams by name using the name query parameter.',
  })
  @ApiResponse({
    status: 200,
    description: 'All teams retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'All teams retrieved successfully for user organizations',
        data: {
          organizations: [
            {
              id: '507f1f77bcf86cd799439011',
              name: 'My Organization',
              logo: '/uploads/organization-logos/logo.png',
              teams: [
                {
                  id: '507f1f77bcf86cd799439012',
                  name: 'Team Alpha',
                  creator: {
                    id: '507f1f77bcf86cd799439013',
                    email: 'creator@example.com',
                    name: 'John Doe',
                  },
                  organization: {
                    id: '507f1f77bcf86cd799439011',
                    name: 'My Organization',
                    logo: '/uploads/organization-logos/logo.png',
                  },
                  memberCount: 5,
                  isActive: true,
                  createdAt: '2024-01-01T00:00:00.000Z',
                  members: [
                    {
                      id: '507f1f77bcf86cd799439014',
                      userId: '507f1f77bcf86cd799439015',
                      name: 'Member Name',
                      email: 'member@example.com',
                      profileImage: null,
                      isAdmin: false,
                      status: STATUS_UPDATE[3],
                      joinedAt: '2024-01-01T00:00:00.000Z',
                      points: 100,
                      rank: 1,
                    },
                  ],
                  totalMembers: 5,
                },
              ],
            },
          ],
          totalOrganizations: 1,
          totalTeams: 1,
        },
      },
    },
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description:
      'Filter team members by status. Valid values: "approved" or "pending". If not provided, returns both approved and pending members.',
    example: 'approved',
  })
  @ApiQuery({
    name: 'name',
    required: false,
    description: 'Filter teams by team name (case-insensitive partial match).',
    example: 'Alpha',
  })
  @ApiResponse({ status: 400, description: 'Invalid user ID' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getAllTeamsForUser(
    @Req() req: Request & { user?: AuthUser },
    @Query('status') status?: string,
    @Query('name') name?: string,
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }
    return this.teamService.getAllTeamsForUser(userId, status, name);
  }

  @Get('team/:teamId/details')
  @ApiOperation({
    summary:
      'Get team details with members sorted by points (highest first, lowest last)',
    description:
      'Retrieves detailed information about a team including all members sorted by their points in descending order.',
  })
  @ApiParam({
    name: 'teamId',
    description: 'Team ID',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiResponse({
    status: 200,
    description: 'Team details with sorted members retrieved successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid team ID' })
  @ApiResponse({ status: 404, description: 'Team not found' })
  async findOneTeam(@Param('teamId') teamId: string) {
    if (!teamId) {
      throw new BadRequestException('Team ID is required');
    }
    return this.teamService.findOneTeam(teamId);
  }

  @Get('team/:teamId')
  @ApiOperation({
    summary: 'Get team members',
    description: 'Retrieves all members of a specific team.',
  })
  @ApiParam({
    name: 'teamId',
    type: String,
    description: 'Team ID to get members for',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiResponse({
    status: 200,
    description: 'Team members retrieved successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid team ID',
  })
  @ApiResponse({
    status: 404,
    description: 'Team not found',
  })
  async getMembers(@Param('teamId') teamId: string) {
    if (!teamId) {
      throw new BadRequestException('Team ID is required');
    }

    return this.teamService.getTeamMembers(teamId);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete organization (creator only)',
    description:
      'Permanently deletes an organization. Only the creator of the organization can delete it.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Organization ID to delete',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiResponse({
    status: 200,
    description: 'Organization deleted successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid organization ID or unauthorized',
  })
  @ApiResponse({
    status: 404,
    description: 'Organization not found',
  })
  async deleteOrganization(
    @Param('id') id: string,
    @Req() req: Request & { user?: AuthUser },
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }
    return this.teamService.deleteOrganization(id, userId);
  }

  @UseGuards(TeamRoleGuard)
  @Post('make-admin')
  @ApiOperation({
    summary: 'Send admin invitation to a user (superAdmin or admin)',
    description:
      'Sends an admin invitation email to a user. The user will receive an invitation to become an admin of the specified organization. Only superAdmin or existing admin users can send invitations.',
  })
  @ApiBody({ type: MakeUserAdminDto })
  @ApiResponse({
    status: 200,
    description: 'Admin invitation sent successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input or user already admin',
  })
  async makeUserAdmin(
    @Req() req: Request & { user?: AuthUser },
    @Body() makeUserAdminDto: MakeUserAdminDto,
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }
    return this.teamService.makeUserAdmin(
      userId,
      makeUserAdminDto.organizationId,
      makeUserAdminDto.email,
      makeUserAdminDto.name,
    );
  }

  @Get('admins')
  @ApiOperation({
    summary: 'Get all admins of an organization (superAdmin or admin only)',
    description:
      'Retrieves all admin users of a specific organization. Organization ID is optional - will be derived from user token if not provided. Supports optional name filtering (case-insensitive partial match) and status filtering (pending/approved). Only superAdmin or admin users can access this API.',
  })
  @ApiQuery({
    name: 'organizationId',
    required: false,
    description:
      'Organization ID (optional - will be derived from admin user if not provided)',
    example: '69326ea68a34e1257f2f09da',
  })
  @ApiQuery({
    name: 'name',
    required: false,
    description:
      'Filter admins by name (partial match, case-insensitive). Example: searching "ch" will match "chhagan"',
    example: 'ch',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description:
      'Filter admins by invitation status from AdminCreation table. Valid values: "pending" or "approved"',
    example: 'pending',
  })
  @ApiResponse({
    status: 200,
    description: 'Admins retrieved successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid organization ID or user ID',
  })
  @ApiResponse({
    status: 403,
    description:
      'Forbidden - Only superAdmin or admin users can access this API',
  })
  @ApiResponse({
    status: 404,
    description: 'Organization or user not found',
  })
  async getAdmin(
    @Query('organizationId') organizationId: string | undefined,
    @Req() req: Request & { user?: AuthUser },
    @Query('name') name?: string,
    @Query('status') status?: string,
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }
    return this.teamService.getAdmin(userId, organizationId, name, status);
  }

  @Delete('admin/:adminUserId')
  @ApiOperation({
    summary: 'Remove an admin from organization using DELETE (superAdmin only)',
    description:
      'Removes an admin user from an organization. Organization ID is optional - will be derived from superAdmin token if not provided. Only superAdmin users can access this API.',
  })
  @ApiResponse({
    status: 200,
    description: 'Admin removed successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid organization ID or admin user ID',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Only superAdmin users can access this API',
  })
  @ApiResponse({
    status: 404,
    description: 'Organization or admin user not found',
  })
  @ApiParam({
    name: 'adminUserId',
    description: 'Admin user ID to remove',
    example: '69326ed68a34e1257f2f09eb',
  })
  @ApiQuery({
    name: 'organizationId',
    required: false,
    description:
      'Organization ID (optional - will be derived from superAdmin user if not provided)',
    example: '69326ea68a34e1257f2f09da',
  })
  async removeAdminDelete(
    @Param('adminUserId') adminUserId: string,
    @Query('organizationId') organizationId: string | undefined,
    @Req() req: Request & { user?: AuthUser },
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }
    return this.teamService.removeAdmin(adminUserId, organizationId, userId);
  }

  @UseGuards(TeamRoleGuard)
  @Post('team/create')
  @ApiOperation({
    summary:
      'Create a team and optionally add multiple members (superAdmin or admin)',
    description:
      'Creates a new team within an organization and optionally adds multiple members by their email addresses. Organization ID is optional - will be derived from admin/superAdmin token if not provided. Only superAdmin or admin users can create teams.',
  })
  @ApiBody({ type: CreateTeamDto })
  @ApiResponse({
    status: 201,
    description: 'Team created successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input or organization not found',
  })
  async createTeamAndAddMember(
    @Req() req: Request & { user?: AuthUser },
    @Body() createTeamDto: CreateTeamDto,
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }
    return this.teamService.createTeamAndAddMember(
      userId,
      createTeamDto.organizationId,
      createTeamDto.teamName,
      createTeamDto.memberEmails,
    );
  }

  @UseGuards(TeamRoleGuard)
  @Post('team/add-member')
  @ApiOperation({
    summary: 'Add multiple members to an existing team (superAdmin or admin)',
    description:
      'Adds multiple members to an existing team by their email addresses. Organization ID is optional - will be derived from admin/superAdmin token if not provided. Only superAdmin or admin users can add members to teams.',
  })
  @ApiBody({ type: AddMemberToTeamDto })
  @ApiResponse({
    status: 200,
    description: 'Members added to team successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input, team not found, or members already in team',
  })
  async addMemberToTeam(
    @Req() req: Request & { user?: AuthUser },
    @Body() addMemberToTeamDto: AddMemberToTeamDto,
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }
    return this.teamService.addMemberToTeam(
      addMemberToTeamDto.teamId,
      userId,
      addMemberToTeamDto.memberEmails,
      addMemberToTeamDto.organizationId,
    );
  }

  // @UseGuards(TeamRoleGuard)
  // @Get('team/members')
  // @ApiOperation({ summary: 'Get all members of a team (superAdmin or admin)' })
  // @ApiQuery({ name: 'teamId', description: 'Team ID', required: true, example: '507f1f77bcf86cd799439011' })
  // @ApiQuery({ name: 'organizationId', description: 'Organization ID', required: true, example: '507f1f77bcf86cd799439011' })
  // async getTeamMembers(
  //   @Req() req: Request & { user?: AuthUser },
  //   @Query('teamId') teamId: string,
  //   @Query('organizationId') organizationId: string
  // ) {
  //   if (!teamId || !organizationId) {
  //     throw new BadRequestException('teamId and organizationId are required');
  //   }
  //   return this.teamService.getTeamMembersWithDetails(
  //     teamId,
  //     organizationId,
  //     req.user.id
  //   );
  // }

  @UseGuards(TeamRoleGuard)
  @Delete('team/remove-member')
  @ApiOperation({
    summary: 'Remove a member from a team (superAdmin or admin)',
    description:
      'Removes a member from a team. Organization ID is optional - will be derived from admin/superAdmin token if not provided. Only superAdmin or admin users can remove members from teams.',
  })
  @ApiBody({ type: RemoveMemberFromTeamDto })
  @ApiResponse({
    status: 200,
    description: 'Member removed from team successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input or member not found in team',
  })
  @ApiResponse({
    status: 404,
    description: 'Team not found',
  })
  async removeMemberFromTeam(
    @Req() req: Request & { user?: AuthUser },
    @Body() removeMemberFromTeamDto: RemoveMemberFromTeamDto,
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }
    return this.teamService.removeMemberFromTeam(
      removeMemberFromTeamDto.teamId,
      userId,
      removeMemberFromTeamDto.memberId,
      removeMemberFromTeamDto.organizationId,
    );
  }

  @UseGuards(TeamRoleGuard)
  @Post('team/move-member')
  @ApiOperation({
    summary:
      'Move a member from one team to another team (superAdmin or admin)',
    description:
      'Moves a member from one team to another team within the same organization. The organization is automatically determined from the authenticated user token. Only superAdmin or admin users can move members.',
  })
  @ApiBody({ type: MoveMemberToTeamDto })
  @ApiResponse({
    status: 200,
    description: 'Member moved to team successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input or member not found in source team',
  })
  @ApiResponse({
    status: 404,
    description: 'Team not found',
  })
  async moveMemberToTeam(
    @Req() req: Request & { user?: AuthUser },
    @Body() moveMemberToTeamDto: MoveMemberToTeamDto,
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }
    return this.teamService.moveMemberToTeam(
      moveMemberToTeamDto.teamId,
      userId,
      moveMemberToTeamDto.memberId,
      moveMemberToTeamDto.moveTeamId,
    );
  }

  @Get('my-decks')
  @ApiOperation({
    summary:
      'Get all decks from organizations where user is a member with pagination, category and name filters',
    description:
      'Retrieves all decks from organizations where the authenticated user is a member (superAdmin, admin, or team member). Supports pagination, category-wise filtering, and deck name search (partial match, case-insensitive).',
  })
  @ApiResponse({
    status: 200,
    description: 'Organization decks retrieved successfully with pagination',
    schema: {
      example: {
        statusCode: 200,
        message: 'User organization decks retrieved successfully',
        data: {
          decks: [
            {
              id: '507f1f77bcf86cd799439011',
              name: 'Sample Deck',
              description: 'Deck description',
              category: 'Technology',
              status: STATUS_UPDATE[0],
              isDefault: false,
              isPublic: false,
              contentIds: [],
              creator: {
                id: '507f1f77bcf86cd799439012',
                name: 'John Doe',
                email: 'john@example.com',
                role: 'admin',
              },
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            },
          ],
          totalDecks: 50,
          page: 1,
          limit: 10,
          totalPages: 5,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid user ID or query parameters',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number (default: 1)',
    example: '1',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of items per page (default: 10)',
    example: '10',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    description: 'Filter decks by category name',
    example: 'Technology',
  })
  @ApiQuery({
    name: 'name',
    required: false,
    description:
      'Filter decks by name (partial match, case-insensitive). Example: searching "H" will match "HTML"',
    example: 'H',
  })
  async getUserOrganizationDecks(
    @Req() req: Request & { user?: AuthUser },
    @Query() query: MyDecksQueryDto,
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }
    const page = query.page ? parseInt(query.page, 10) : 1;
    const limit = query.limit ? parseInt(query.limit, 10) : 10;
    const category = query.category;
    const name = query.name;

    if (page < 1) {
      throw new BadRequestException('Page must be greater than 0');
    }
    if (limit < 1) {
      throw new BadRequestException('Limit must be greater than 0');
    }

    return this.teamService.getUserOrganizationDecks(
      userId,
      page,
      limit,
      category,
      name,
    );
  }

  @Get('dashboard')
  @ApiOperation({
    summary:
      'Get dashboard data with teams, members, and statistics for user organization',
  })
  @ApiResponse({
    status: 200,
    description: 'Dashboard data retrieved successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid user ID' })
  @ApiResponse({ status: 404, description: 'User or organization not found' })
  async getDashboard(@Req() req: Request & { user?: AuthUser }) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }
    return this.teamService.getDashboard(userId);
  }

  @Get('users/online')
  @ApiOperation({
    summary: 'Get all online users (superAdmin, admin, or member)',
    description:
      'Retrieves all users with userType superAdmin, admin, or member who are currently online (isOnline=true). For members, includes teamId and teamName. For superAdmin and admin, teamId and teamName are null. Only users with these roles can access this API.',
  })
  @ApiResponse({
    status: 200,
    description: 'Online users retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Online users retrieved successfully',
        data: {
          users: [
            {
              id: '507f1f77bcf86cd799439011',
              name: 'John Doe',
              email: 'john@example.com',
              userType: 'member',
              isOnline: true,
              profileImage: null,
              lastSeen: '2024-01-01T00:00:00.000Z',
              teamId: '507f1f77bcf86cd799439013',
              teamName: 'Development Team',
              organization: {
                id: '507f1f77bcf86cd799439012',
                name: 'My Organization',
                logo: '/uploads/organization-logos/logo.png',
              },
            },
            {
              id: '507f1f77bcf86cd799439014',
              name: 'Admin User',
              email: 'admin@example.com',
              userType: 'admin',
              isOnline: true,
              profileImage: null,
              lastSeen: '2024-01-01T00:00:00.000Z',
              teamId: null,
              teamName: null,
              organization: {
                id: '507f1f77bcf86cd799439012',
                name: 'My Organization',
                logo: '/uploads/organization-logos/logo.png',
              },
            },
          ],
          totalOnlineUsers: 2,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid user ID',
  })
  @ApiResponse({
    status: 403,
    description:
      'Forbidden - Only superAdmin, admin, or member users can access this API',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  async getUsersOnline(@Req() req: Request & { user?: AuthUser }) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }
    return this.teamService.getUsersOnline(userId);
  }

  @Get('knowledge-improvement')
  @ApiOperation({
    summary: 'Get knowledge improvement decks with optional deck name search',
    description:
      'Retrieves knowledge improvement decks for a specific user with their accuracy data. Optionally filters decks by name using a search term.',
  })
  @ApiResponse({
    status: 200,
    description: 'Knowledge improvement decks retrieved successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid user ID',
  })
  @ApiQuery({
    name: 'userId',
    required: false,
    description:
      'Optional target user ID to fetch accuracy for. If not provided, uses the authenticated user from token.',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiQuery({
    name: 'searchTerm',
    required: false,
    description: 'Optional deck name search term',
    example: 'Python',
  })
  async getKnowledgeImprovementDecks(
    @Req() req: Request & { user?: AuthUser },
    @Query('userId') userId?: string,
    @Query('searchTerm') searchTerm?: string,
  ) {
    const authenticatedUserId =
      req.user?.id || req.user?._id || req.user?.userId;
    if (!authenticatedUserId) {
      throw new BadRequestException('User authentication required');
    }
    return this.teamService.getKnowledgeImprovementDecks(
      authenticatedUserId,
      userId,
      searchTerm,
    );
  }

  @Patch('deck/:deckId/name')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Update deck name',
    description:
      'Updates only the name of a deck superAdmin & admin by the authenticated user.',
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
    @Req() req: Request & { user?: AuthUser },
    @Param('deckId') deckId: string,
    @Body() body: UpdateDeckNameDto,
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }

    return this.teamService.updateDeckName(deckId, userId, body.name);
  }

  @Delete('deck/:deckId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Delete deck with topics and subtopics (superAdmin or admin only)',
    description:
      'Permanently deletes a deck along with all its associated topics and subtopics from the database. Only superAdmin or admin users can delete decks.',
  })
  @ApiParam({
    name: 'deckId',
    type: String,
    description: 'Deck ID to delete',
    example: '67501b23842d45d1c3d9f91a',
  })
  @ApiResponse({
    status: 200,
    description: 'Deck, topics, and subtopics deleted successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Deck, topics, and subtopics deleted successfully',
        data: {
          deletedDeck: {
            id: '67501b23842d45d1c3d9f91a',
            name: 'Sample Deck',
          },
          deletedTopicsCount: 5,
          deletedSubtopicsCount: 15,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid deck ID or user ID',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Only superAdmin or admin users can delete decks',
  })
  @ApiResponse({
    status: 404,
    description: 'Deck not found',
  })
  async deleteDeck(
    @Req() req: Request & { user?: AuthUser },
    @Param('deckId') deckId: string,
  ) {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }

    return this.teamService.deleteDeck(deckId, userId);
  }
}
