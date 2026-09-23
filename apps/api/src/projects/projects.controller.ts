import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createFolderSchema,
  createProjectSchema,
  updateFolderSchema,
  updateProjectSchema,
  type CreateFolderRequest,
  type CreateProjectRequest,
  type FolderDto,
  type OkResponse,
  type ProjectDto,
  type UpdateFolderRequest,
  type UpdateProjectRequest,
} from '@inkflow/shared';
import { CurrentUser, type AuthInfo } from '../common/request';
import { ApiZodBody, IdParam, ZBody } from '../common/validation';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@ApiCookieAuth()
@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('workspaces/:id/projects')
  @ApiOperation({ summary: 'Projects of a workspace' })
  list(@CurrentUser() user: AuthInfo, @IdParam('id', 'Workspace') workspaceId: string): Promise<ProjectDto[]> {
    return this.projects.listProjects(user.userId, workspaceId);
  }

  @Post('workspaces/:id/projects')
  @ApiZodBody(createProjectSchema)
  @ApiOperation({ summary: 'Create a project' })
  create(
    @CurrentUser() user: AuthInfo,
    @IdParam('id', 'Workspace') workspaceId: string,
    @ZBody(createProjectSchema) body: CreateProjectRequest,
  ): Promise<ProjectDto> {
    return this.projects.createProject(user.userId, workspaceId, body);
  }

  @Patch('projects/:id')
  @ApiZodBody(updateProjectSchema)
  @ApiOperation({ summary: 'Update a project' })
  update(
    @CurrentUser() user: AuthInfo,
    @IdParam('id', 'Project') id: string,
    @ZBody(updateProjectSchema) body: UpdateProjectRequest,
  ): Promise<ProjectDto> {
    return this.projects.updateProject(user.userId, id, body);
  }

  @Delete('projects/:id')
  @ApiOperation({ summary: 'Delete a project (its boards move to the trash)' })
  async remove(@CurrentUser() user: AuthInfo, @IdParam('id', 'Project') id: string): Promise<OkResponse> {
    await this.projects.deleteProject(user.userId, id);
    return { ok: true };
  }

  @Get('workspaces/:id/folders')
  @ApiOperation({ summary: 'Folders of a workspace' })
  listFolders(@CurrentUser() user: AuthInfo, @IdParam('id', 'Workspace') workspaceId: string): Promise<FolderDto[]> {
    return this.projects.listFolders(user.userId, workspaceId);
  }

  @Post('workspaces/:id/folders')
  @ApiZodBody(createFolderSchema)
  @ApiOperation({ summary: 'Create a folder' })
  createFolder(
    @CurrentUser() user: AuthInfo,
    @IdParam('id', 'Workspace') workspaceId: string,
    @ZBody(createFolderSchema) body: CreateFolderRequest,
  ): Promise<FolderDto> {
    return this.projects.createFolder(user.userId, workspaceId, body);
  }

  @Patch('folders/:id')
  @ApiZodBody(updateFolderSchema)
  @ApiOperation({ summary: 'Rename or move a folder' })
  updateFolder(
    @CurrentUser() user: AuthInfo,
    @IdParam('id', 'Folder') id: string,
    @ZBody(updateFolderSchema) body: UpdateFolderRequest,
  ): Promise<FolderDto> {
    return this.projects.updateFolder(user.userId, id, body);
  }

  @Delete('folders/:id')
  @ApiOperation({ summary: 'Delete a folder (boards move to the parent folder / root)' })
  async removeFolder(@CurrentUser() user: AuthInfo, @IdParam('id', 'Folder') id: string): Promise<OkResponse> {
    await this.projects.deleteFolder(user.userId, id);
    return { ok: true };
  }
}
