import { Injectable } from '@nestjs/common';
import type { Folder, Project } from '@inkflow/database';
import {
  isUuid,
  workspaceRoleAtLeast,
  type CreateFolderRequest,
  type CreateProjectRequest,
  type FolderDto,
  type ProjectDto,
  type UpdateFolderRequest,
  type UpdateProjectRequest,
} from '@inkflow/shared';
import { AccessService } from '../access/access.service';
import { RealtimeService } from '../collaboration/realtime.service';
import { Errors } from '../common/errors';
import { iso } from '../common/mappers';
import { PrismaService } from '../prisma/prisma.service';

const MAX_FOLDER_DEPTH = 32;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly realtime: RealtimeService,
  ) {}

  private toProject(p: Project, boardCount: number): ProjectDto {
    return {
      id: p.id,
      workspaceId: p.workspaceId,
      name: p.name,
      description: p.description,
      boardCount,
      createdAt: iso(p.createdAt),
      updatedAt: iso(p.updatedAt),
    };
  }

  private toFolder(f: Folder): FolderDto {
    return {
      id: f.id,
      workspaceId: f.workspaceId,
      projectId: f.projectId,
      parentId: f.parentId,
      name: f.name,
      createdAt: iso(f.createdAt),
    };
  }

  private async boardCounts(projectIds: string[]): Promise<Map<string, number>> {
    if (projectIds.length === 0) return new Map();
    const rows = await this.prisma.board.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projectIds }, deletedAt: null },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.projectId!, r._count._all]));
  }

  /** Creator or workspace ADMIN+ may modify a project/folder. */
  private async requireManage(workspaceId: string, userId: string, createdById: string | null): Promise<void> {
    const role = await this.access.requireWorkspace(workspaceId, userId);
    if (createdById !== userId && !workspaceRoleAtLeast(role, 'ADMIN')) throw Errors.forbidden();
  }

  // ───────────── projects ─────────────

  async listProjects(userId: string, workspaceId: string): Promise<ProjectDto[]> {
    await this.access.requireWorkspace(workspaceId, userId);
    const projects = await this.prisma.project.findMany({ where: { workspaceId }, orderBy: { name: 'asc' } });
    const counts = await this.boardCounts(projects.map((p) => p.id));
    return projects.map((p) => this.toProject(p, counts.get(p.id) ?? 0));
  }

  async createProject(userId: string, workspaceId: string, input: CreateProjectRequest): Promise<ProjectDto> {
    await this.access.requireWorkspace(workspaceId, userId);
    const project = await this.prisma.project.create({
      data: { workspaceId, name: input.name, description: input.description || null, createdById: userId },
    });
    return this.toProject(project, 0);
  }

  private async findProject(userId: string, projectId: string): Promise<Project> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project || !(await this.access.workspaceRole(project.workspaceId, userId))) throw Errors.notFound('Project');
    return project;
  }

  async updateProject(userId: string, projectId: string, input: UpdateProjectRequest): Promise<ProjectDto> {
    const project = await this.findProject(userId, projectId);
    await this.requireManage(project.workspaceId, userId, project.createdById);
    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
      },
    });
    const counts = await this.boardCounts([projectId]);
    return this.toProject(updated, counts.get(projectId) ?? 0);
  }

  /** Deletes a project; its boards move to the trash. */
  async deleteProject(userId: string, projectId: string): Promise<void> {
    const project = await this.findProject(userId, projectId);
    await this.requireManage(project.workspaceId, userId, project.createdById);
    const boards = await this.prisma.board.findMany({ where: { projectId, deletedAt: null }, select: { id: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.board.updateMany({
        where: { projectId, deletedAt: null },
        data: { deletedAt: new Date(), deletedById: userId },
      });
      await tx.board.updateMany({ where: { projectId }, data: { projectId: null, folderId: null } });
      await tx.project.delete({ where: { id: projectId } });
    });
    await Promise.all(boards.map((b) => this.realtime.emitEvent(b.id, { kind: 'board-deleted' })));
  }

  // ───────────── folders ─────────────

  async listFolders(userId: string, workspaceId: string): Promise<FolderDto[]> {
    await this.access.requireWorkspace(workspaceId, userId);
    const folders = await this.prisma.folder.findMany({ where: { workspaceId }, orderBy: { name: 'asc' } });
    return folders.map((f) => this.toFolder(f));
  }

  private async folderInWorkspace(folderId: string, workspaceId: string): Promise<Folder> {
    const folder = isUuid(folderId) ? await this.prisma.folder.findUnique({ where: { id: folderId } }) : null;
    if (!folder || folder.workspaceId !== workspaceId) throw Errors.validation('Parent folder not found in this workspace');
    return folder;
  }

  async createFolder(userId: string, workspaceId: string, input: CreateFolderRequest): Promise<FolderDto> {
    await this.access.requireWorkspace(workspaceId, userId);
    let projectId = input.projectId ?? null;
    let parentId: string | null = null;
    if (input.parentId) {
      const parent = await this.folderInWorkspace(input.parentId, workspaceId);
      if (projectId && parent.projectId !== projectId) throw Errors.validation('Parent folder belongs to another project');
      projectId = parent.projectId;
      parentId = parent.id;
    }
    if (projectId) {
      const project = isUuid(projectId) ? await this.prisma.project.findUnique({ where: { id: projectId } }) : null;
      if (!project || project.workspaceId !== workspaceId) throw Errors.validation('Project not found in this workspace');
    }
    const folder = await this.prisma.folder.create({
      data: { workspaceId, projectId, parentId, name: input.name, createdById: userId },
    });
    return this.toFolder(folder);
  }

  private async findFolder(userId: string, folderId: string): Promise<Folder> {
    const folder = await this.prisma.folder.findUnique({ where: { id: folderId } });
    if (!folder || !(await this.access.workspaceRole(folder.workspaceId, userId))) throw Errors.notFound('Folder');
    return folder;
  }

  async updateFolder(userId: string, folderId: string, input: UpdateFolderRequest): Promise<FolderDto> {
    const folder = await this.findFolder(userId, folderId);
    await this.requireManage(folder.workspaceId, userId, folder.createdById);
    let parentId = folder.parentId;
    if (input.parentId !== undefined) {
      if (input.parentId === null) {
        parentId = null;
      } else {
        const parent = await this.folderInWorkspace(input.parentId, folder.workspaceId);
        if (parent.projectId !== folder.projectId) throw Errors.validation('Parent folder belongs to another project');
        // Reject cycles: walk up from the new parent.
        let cursor: Folder | null = parent;
        for (let depth = 0; cursor; depth++) {
          if (cursor.id === folder.id) throw Errors.validation('A folder cannot be moved into itself');
          if (depth > MAX_FOLDER_DEPTH) throw Errors.validation('Folders are nested too deeply');
          cursor = cursor.parentId ? await this.prisma.folder.findUnique({ where: { id: cursor.parentId } }) : null;
        }
        parentId = parent.id;
      }
    }
    const updated = await this.prisma.folder.update({
      where: { id: folderId },
      data: { ...(input.name !== undefined ? { name: input.name } : {}), parentId },
    });
    return this.toFolder(updated);
  }

  /** Deletes a folder; its boards and sub-folders move to the parent folder (or the root). */
  async deleteFolder(userId: string, folderId: string): Promise<void> {
    const folder = await this.findFolder(userId, folderId);
    await this.requireManage(folder.workspaceId, userId, folder.createdById);
    await this.prisma.$transaction(async (tx) => {
      await tx.board.updateMany({ where: { folderId }, data: { folderId: folder.parentId } });
      await tx.folder.updateMany({ where: { parentId: folderId }, data: { parentId: folder.parentId } });
      await tx.folder.delete({ where: { id: folderId } });
    });
  }
}
