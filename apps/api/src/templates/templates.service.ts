import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Prisma, type Template } from '@inkflow/database';
import { SYSTEM_TEMPLATES, type TemplateDefinition } from '@inkflow/diagram-engine';
import {
  DEFAULT_DOCUMENT_APP_STATE,
  parseDocument,
  serializeDocument,
  type SceneDocument,
} from '@inkflow/scene';
import {
  workspaceRoleAtLeast,
  type CreateTemplateRequest,
  type TemplateCategory,
  type TemplateDetailDto,
  type TemplateSummaryDto,
} from '@inkflow/shared';
import { AccessService } from '../access/access.service';
import { Errors } from '../common/errors';
import { iso } from '../common/mappers';
import { toSerializedDocument } from '../documents/board-document.service';
import { PrismaService } from '../prisma/prisma.service';

type TemplateSummaryRow = Omit<Template, 'document'>;

const summarySelect = {
  id: true,
  key: true,
  name: true,
  description: true,
  category: true,
  isSystem: true,
  workspaceId: true,
  createdById: true,
  elementCount: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function toTemplateSummary(t: TemplateSummaryRow): TemplateSummaryDto {
  return {
    id: t.id,
    key: t.key,
    name: t.name,
    description: t.description,
    category: t.category as TemplateCategory,
    isSystem: t.isSystem,
    workspaceId: t.workspaceId,
    elementCount: t.elementCount,
    createdAt: iso(t.createdAt),
  };
}

/** Builds the stored document of a built-in template. */
export function buildSystemTemplateDocument(def: TemplateDefinition): SceneDocument {
  const content = def.build();
  return serializeDocument(content.elements, { ...DEFAULT_DOCUMENT_APP_STATE, ...(content.appState ?? {}) }, {}, {
    source: `template:${def.key}`,
  });
}

@Injectable()
export class TemplatesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.syncSystemTemplates(SYSTEM_TEMPLATES);
    } catch (err) {
      this.logger.error(`Failed to sync system templates: ${(err as Error).message}`);
    }
  }

  /** Upserts the built-in templates (keyed by `key`) and removes ones that no longer exist. */
  async syncSystemTemplates(definitions: readonly TemplateDefinition[]): Promise<number> {
    let synced = 0;
    for (const def of definitions) {
      let document: SceneDocument;
      try {
        // Validate like any untrusted document so boards created from it are always well-formed.
        const parsed = parseDocument(buildSystemTemplateDocument(def));
        if (parsed.issues.length > 0) {
          this.logger.warn(`Template "${def.key}": dropped ${parsed.issues.length} invalid element(s): ${parsed.issues[0]!.message}`);
        }
        document = { ...parsed.document, source: `template:${def.key}` };
      } catch (err) {
        this.logger.error(`Template "${def.key}" failed to build: ${(err as Error).message}`);
        continue;
      }
      const data = {
        name: def.name.slice(0, 120),
        description: def.description.slice(0, 1000),
        category: def.category,
        isSystem: true,
        workspaceId: null,
        document: document as unknown as Prisma.InputJsonValue,
        elementCount: document.elements.length,
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await this.prisma.template.upsert({ where: { key: def.key }, create: { key: def.key, ...data }, update: data });
          synced++;
          break;
        } catch (err) {
          // Another instance created it concurrently: retry as an update.
          if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') || attempt === 1) throw err;
        }
      }
    }
    const keys = definitions.map((d) => d.key);
    await this.prisma.template.deleteMany({ where: { isSystem: true, key: { notIn: keys } } });
    if (synced > 0) this.logger.log(`Synced ${synced} system template(s)`);
    return synced;
  }

  async list(userId: string, workspaceId?: string): Promise<TemplateSummaryDto[]> {
    let workspaceIds: string[];
    if (workspaceId) {
      await this.access.requireWorkspace(workspaceId, userId);
      workspaceIds = [workspaceId];
    } else {
      const memberships = await this.prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true } });
      workspaceIds = memberships.map((m) => m.workspaceId);
    }
    const rows = await this.prisma.template.findMany({
      where: { OR: [{ isSystem: true }, { workspaceId: { in: workspaceIds } }] },
      select: summarySelect,
      orderBy: [{ isSystem: 'desc' }, { category: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toTemplateSummary);
  }

  /** A template the user may use (system, or of a workspace they belong to). */
  async findUsable(userId: string, templateId: string): Promise<Template> {
    const template = await this.prisma.template.findUnique({ where: { id: templateId } });
    if (!template) throw Errors.notFound('Template');
    if (!template.isSystem) {
      if (!template.workspaceId || !(await this.access.workspaceRole(template.workspaceId, userId))) {
        throw Errors.notFound('Template');
      }
    }
    return template;
  }

  async get(userId: string, templateId: string): Promise<TemplateDetailDto> {
    const template = await this.findUsable(userId, templateId);
    const document = parseDocument(template.document).document;
    return { ...toTemplateSummary(template), document: toSerializedDocument(document) };
  }

  async create(userId: string, input: CreateTemplateRequest): Promise<TemplateSummaryDto> {
    await this.access.requireWorkspace(input.workspaceId, userId);
    let document: SceneDocument;
    try {
      document = parseDocument(input.document).document;
    } catch (err) {
      throw Errors.validation(`Invalid document: ${(err as Error).message}`);
    }
    const stored = serializeDocument(document.elements, document.appState, {});
    const template = await this.prisma.template.create({
      data: {
        name: input.name,
        description: input.description ?? '',
        category: input.category ?? 'other',
        isSystem: false,
        workspaceId: input.workspaceId,
        createdById: userId,
        document: stored as unknown as Prisma.InputJsonValue,
        elementCount: stored.elements.length,
      },
      select: summarySelect,
    });
    return toTemplateSummary(template);
  }

  async remove(userId: string, templateId: string): Promise<void> {
    const template = await this.findUsable(userId, templateId);
    if (template.isSystem) throw Errors.forbidden('Built-in templates cannot be deleted');
    const role = await this.access.workspaceRole(template.workspaceId!, userId);
    if (template.createdById !== userId && !workspaceRoleAtLeast(role, 'ADMIN')) throw Errors.forbidden();
    await this.prisma.template.delete({ where: { id: templateId } });
  }
}
