import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { SEED_BOARDS } from '@inkflow/diagram-engine';
import { DEFAULT_DOCUMENT_APP_STATE, serializeDocument } from '@inkflow/scene';
import { hashPassword } from '../auth/passwords';
import { BoardsService } from '../boards/boards.service';
import { createAppContext } from '../bootstrap';
import { loadEnvironment } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

export const DEMO_USERS = [
  { email: 'demo@inkflow.dev', name: 'Demo User', password: 'inkflow-demo-2024' },
  { email: 'alex@inkflow.dev', name: 'Alex Rivera', password: 'inkflow-demo-2024' },
] as const;
export const DEMO_WORKSPACE = 'Inkflow Demo';

/** Seed boards grouped into demo projects (keys from SEED_BOARDS). */
const PROJECT_OF: Record<string, string> = {
  'seed-architecture': 'Engineering',
  'seed-er-diagram': 'Engineering',
  'seed-uml-class': 'Engineering',
  'seed-flowchart': 'Product',
  'seed-mind-map': 'Product',
  'seed-kanban': 'Product',
};

async function ensureUser(prisma: PrismaService, u: (typeof DEMO_USERS)[number]) {
  const existing = await prisma.user.findUnique({ where: { email: u.email } });
  if (existing) return { user: existing, created: false };
  const user = await prisma.user.create({
    data: {
      email: u.email,
      name: u.name,
      passwordHash: await hashPassword(u.password),
      emailVerifiedAt: new Date(),
    },
  });
  return { user, created: true };
}

async function main(): Promise<void> {
  const env = loadEnvironment();
  const ctx = await createAppContext(env);
  const log = new Logger('Seed');
  try {
    const prisma = ctx.get(PrismaService);
    const workspaces = ctx.get(WorkspacesService);
    const projects = ctx.get(ProjectsService);
    const boards = ctx.get(BoardsService);

    const [{ user: demo }, { user: alex }] = await Promise.all(
      DEMO_USERS.map((u) => ensureUser(prisma, u)),
    );

    const existing = await prisma.workspace.findFirst({
      where: { name: DEMO_WORKSPACE, members: { some: { userId: demo.id, role: 'OWNER' } } },
    });
    if (existing) {
      log.log(`Demo workspace already exists (${existing.id}); nothing to do.`);
      return;
    }

    const workspace = await workspaces.create(demo.id, { name: DEMO_WORKSPACE });
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: alex.id } },
      create: { workspaceId: workspace.id, userId: alex.id, role: 'MEMBER' },
      update: {},
    });

    const projectIds = new Map<string, string>();
    for (const name of new Set(Object.values(PROJECT_OF))) {
      const p = await projects.createProject(demo.id, workspace.id, {
        name,
        description:
          name === 'Engineering'
            ? 'System design, data models and UML'
            : 'Planning, flows and ideation',
      });
      projectIds.set(name, p.id);
    }

    const created: string[] = [];
    for (const def of SEED_BOARDS) {
      const content = def.build();
      const document = serializeDocument(
        content.elements,
        { ...DEFAULT_DOCUMENT_APP_STATE, ...content.appState },
        {},
      );
      const board = await boards.create(demo.id, {
        workspaceId: workspace.id,
        projectId: projectIds.get(PROJECT_OF[def.key] ?? '') ?? null,
        title: def.name,
        document: { ...document, appState: { ...document.appState } },
      });
      created.push(board.id);
      log.log(`Created board "${def.name}" (${content.elements.length} elements)`);
    }
    if (created[0]) {
      await boards.setFavorite(demo.id, created[0], true);
      const first = await prisma.boardElement.findFirst({
        where: { boardId: created[0], isDeleted: false },
      });
      await prisma.comment.create({
        data: {
          boardId: created[0],
          authorId: alex.id,
          body: 'Looks great! Should we add a retry path for failed payments?',
          anchor: first
            ? { type: 'element', elementId: first.elementId, x: 10, y: 10 }
            : { type: 'point', x: 0, y: 0 },
        },
      });
    }
    log.log(`Seed complete. Sign in with ${DEMO_USERS[0].email} / ${DEMO_USERS[0].password}`);
  } finally {
    await ctx.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
