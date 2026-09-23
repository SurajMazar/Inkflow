import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createElement } from '@inkflow/elements';
import { generateNKeysBetween } from '@inkflow/scene';
import type {
  BoardDetailDto,
  BoardSummaryDto,
  HealthCheckDto,
  SearchResultDto,
  TemplateDetailDto,
  TemplateSummaryDto,
} from '@inkflow/shared';
import type { TemplateDefinition } from '@inkflow/diagram-engine';
import { TemplatesService } from '../src/templates/templates.service';
import { createBoard, element, personalWorkspace, signUp, startApp, TestClient, type TestApp } from './helpers';

let t: TestApp;

beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t?.close();
});

function sampleDocument() {
  const keys = generateNKeysBetween(null, null, 3);
  return {
    version: 2,
    elements: [
      element('rectangle', { id: 'rect-1', index: keys[0]!, label: null }),
      element('text', { id: 'text-1', index: keys[1]!, text: 'Quarterly kangaroo metrics' }),
      element('frame', { id: 'frame-1', index: keys[2]!, name: 'Payments frame' }),
    ],
    appState: { viewBackgroundColor: '#fafafa' },
    files: {},
  };
}

describe('boards', () => {
  it('creates, lists, renames, favorites, trashes, restores and deletes boards', async () => {
    const owner = await signUp(t.url, 'Board Owner');
    const ws = await personalWorkspace(owner);
    const created = await owner.post<BoardSummaryDto>('/api/boards', { workspaceId: ws.id, title: 'Architecture' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ title: 'Architecture', role: 'OWNER', workspaceAccess: 'EDITOR', elementCount: 0 });
    const second = await createBoard(owner, { title: 'Second' });

    const detail = await owner.get<BoardDetailDto>(`/api/boards/${created.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.seq).toBe(0);
    expect(detail.body.document.elements).toEqual([]);
    expect(detail.body.viaShareLink).toBe(false);

    const all = await owner.get<BoardSummaryDto[]>('/api/boards', { query: { workspaceId: ws.id } });
    expect(all.body.map((b) => b.id).sort()).toEqual([created.body.id, second.id].sort());
    const q = await owner.get<BoardSummaryDto[]>('/api/boards', { query: { q: 'archi' } });
    expect(q.body.map((b) => b.id)).toEqual([created.body.id]);
    const recent = await owner.get<BoardSummaryDto[]>('/api/boards', { query: { filter: 'recent' } });
    expect(recent.body.map((b) => b.id)).toEqual([created.body.id]);
    expect(recent.body[0]!.lastViewedAt).toBeTruthy();

    const renamed = await owner.patch<BoardSummaryDto>(`/api/boards/${created.body.id}`, {
      title: 'Architecture v2',
      appState: { viewBackgroundColor: '#000000' },
    });
    expect(renamed.body.title).toBe('Architecture v2');
    expect((await owner.patch(`/api/boards/${created.body.id}`, { title: '' })).status).toBe(400);

    expect((await owner.put(`/api/boards/${second.id}/favorite`)).status).toBe(200);
    const favorites = await owner.get<BoardSummaryDto[]>('/api/boards', { query: { filter: 'favorites' } });
    expect(favorites.body.map((b) => b.id)).toEqual([second.id]);
    expect(favorites.body[0]!.isFavorite).toBe(true);
    expect((await owner.delete(`/api/boards/${second.id}/favorite`)).status).toBe(200);
    expect((await owner.get<BoardSummaryDto[]>('/api/boards', { query: { filter: 'favorites' } })).body).toHaveLength(0);

    // Trash → restore → trash → permanent delete.
    expect((await owner.delete(`/api/boards/${second.id}/permanent`)).status).toBe(409);
    expect((await owner.delete(`/api/boards/${second.id}`)).status).toBe(200);
    expect((await owner.get(`/api/boards/${second.id}`)).status).toBe(404);
    const trash = await owner.get<BoardSummaryDto[]>('/api/boards', { query: { filter: 'trash' } });
    expect(trash.body.map((b) => b.id)).toEqual([second.id]);
    expect(trash.body[0]!.deletedAt).toBeTruthy();
    const restored = await owner.post<BoardSummaryDto>(`/api/boards/${second.id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.deletedAt).toBeNull();
    await owner.delete(`/api/boards/${second.id}`);
    expect((await owner.delete(`/api/boards/${second.id}/permanent`)).status).toBe(200);
    expect(await t.prisma.board.findUnique({ where: { id: second.id } })).toBeNull();

    // Empty trash.
    const third = await createBoard(owner, { title: 'Third' });
    await owner.delete(`/api/boards/${third.id}`);
    const emptied = await owner.post<{ deleted: number }>('/api/boards/trash/empty', { workspaceId: ws.id });
    expect(emptied.body.deleted).toBe(1);
  });

  it('creates boards from a document, duplicates them and rejects invalid documents', async () => {
    const owner = await signUp(t.url, 'Importer');
    const imported = await createBoard(owner, { title: 'Imported', document: sampleDocument() });
    const detail = await owner.get<BoardDetailDto>(`/api/boards/${imported.id}`);
    expect(detail.body.document.elements.map((e) => (e as { id: string }).id)).toEqual(['rect-1', 'text-1', 'frame-1']);
    expect(detail.body.document.appState.viewBackgroundColor).toBe('#fafafa');
    expect(detail.body.board.elementCount).toBe(3);

    const bad = await owner.post('/api/boards', {
      workspaceId: imported.workspaceId,
      document: { version: 999, elements: [], appState: {}, files: {} },
    });
    expect(bad.status).toBe(400);

    const dup = await owner.post<BoardSummaryDto>(`/api/boards/${imported.id}/duplicate`);
    expect(dup.status).toBe(201);
    expect(dup.body.title).toBe('Imported (copy)');
    const dupDetail = await owner.get<BoardDetailDto>(`/api/boards/${dup.body.id}`);
    expect(dupDetail.body.document.elements).toHaveLength(3);
  });

  it('syncs system templates and creates boards from templates with fresh ids', async () => {
    const owner = await signUp(t.url, 'Templater');
    const definition: TemplateDefinition = {
      key: 'test-kanban',
      name: 'Test Kanban',
      description: 'A board for tests',
      category: 'planning',
      build: () => {
        const keys = generateNKeysBetween(null, null, 2);
        return {
          elements: [
            createElement('rectangle', { id: 'tpl-a', x: 0, y: 0, width: 100, height: 100, index: keys[0]! }),
            createElement('text', { id: 'tpl-b', x: 0, y: 150, width: 100, height: 20, text: 'To do', index: keys[1]! }),
          ],
        };
      },
    };
    await t.app.get(TemplatesService).syncSystemTemplates([definition]);
    const list = await owner.get<TemplateSummaryDto[]>('/api/templates');
    const tpl = list.body.find((x) => x.key === 'test-kanban')!;
    expect(tpl).toMatchObject({ isSystem: true, category: 'planning', elementCount: 2, workspaceId: null });
    const tplDetail = await owner.get<TemplateDetailDto>(`/api/templates/${tpl.id}`);
    expect(tplDetail.body.document.elements).toHaveLength(2);

    const board = await createBoard(owner, { templateId: tpl.id, title: 'From template' });
    const detail = await owner.get<BoardDetailDto>(`/api/boards/${board.id}`);
    const ids = detail.body.document.elements.map((e) => (e as { id: string }).id);
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain('tpl-a');

    // Workspace templates.
    const ws = await personalWorkspace(owner);
    const custom = await owner.post<TemplateSummaryDto>('/api/templates', {
      name: 'My template',
      workspaceId: ws.id,
      document: sampleDocument(),
    });
    expect(custom.status).toBe(201);
    expect(custom.body).toMatchObject({ isSystem: false, workspaceId: ws.id, elementCount: 3 });
    const stranger = await signUp(t.url, 'Template Stranger');
    expect((await stranger.get(`/api/templates/${custom.body.id}`)).status).toBe(404);
    expect((await owner.delete(`/api/templates/${tpl.id}`)).status).toBe(403);
    expect((await owner.delete(`/api/templates/${custom.body.id}`)).status).toBe(200);
  });

  it('searches titles and element text of accessible boards only', async () => {
    const owner = await signUp(t.url, 'Searcher');
    const board = await createBoard(owner, { title: 'Wombat planning', document: sampleDocument() });
    const byText = await owner.get<SearchResultDto[]>('/api/search', { query: { q: 'kangaroo' } });
    expect(byText.status).toBe(200);
    expect(byText.body).toHaveLength(1);
    expect(byText.body[0]).toMatchObject({ boardId: board.id, titleMatch: false });
    expect(byText.body[0]!.matches[0]).toMatchObject({ elementId: 'text-1', elementType: 'text' });
    expect(byText.body[0]!.matches[0]!.text).toContain('kangaroo');
    const byFrame = await owner.get<SearchResultDto[]>('/api/search', { query: { q: 'payments' } });
    expect(byFrame.body[0]!.matches[0]!.elementId).toBe('frame-1');
    const byTitle = await owner.get<SearchResultDto[]>('/api/search', { query: { q: 'wombat' } });
    expect(byTitle.body[0]!.titleMatch).toBe(true);
    const stranger = await signUp(t.url, 'Nosy');
    expect((await stranger.get<SearchResultDto[]>('/api/search', { query: { q: 'kangaroo' } })).body).toHaveLength(0);
    expect((await owner.get('/api/search')).status).toBe(400);
  });

  it('reports health and readiness', async () => {
    const anon = new TestClient(t.url);
    const live = await anon.get<HealthCheckDto>('/api/health');
    expect(live.body.status).toBe('ok');
    const ready = await anon.get<HealthCheckDto>('/api/health/ready');
    expect(ready.status).toBe(200);
    expect(Object.keys(ready.body.checks).sort()).toEqual(['database', 'redis', 'storage']);
    expect(Object.values(ready.body.checks).every((c) => c.status === 'ok' && typeof c.latencyMs === 'number')).toBe(true);
    const docs = await anon.get<{ openapi: string; paths: Record<string, unknown> }>('/api/docs-json');
    expect(docs.body.openapi).toMatch(/^3\./);
    expect(Object.keys(docs.body.paths)).toContain('/api/boards/{id}');
  });
});
