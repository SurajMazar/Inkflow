import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OpResult } from '@inkflow/collaboration';
import type { BoardDetailDto, BoardSummaryDto, FileDto, ShareLinkDto } from '@inkflow/shared';
import {
  createBoard,
  createOp,
  element,
  op,
  PNG_1X1,
  signUp,
  startApp,
  TestClient,
  type TestApp,
} from './helpers';

let t: TestApp;

beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t?.close();
});

const SAFE_SVG = Buffer.from(
  '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect width="40" height="20" fill="red"/></svg>',
);

describe('files', () => {
  it('uploads, validates and serves images with safe headers', async () => {
    const owner = await signUp(t.url, 'Uploader');
    const board = await createBoard(owner);

    const png = await owner.upload<FileDto>(
      '/api/files',
      { buffer: PNG_1X1, filename: 'dot.png', contentType: 'image/png' },
      { boardId: board.id },
    );
    expect(png.status).toBe(201);
    expect(png.body).toMatchObject({
      boardId: board.id,
      mimeType: 'image/png',
      width: 1,
      height: 1,
      size: PNG_1X1.length,
      originalName: 'dot.png',
    });
    expect(png.body.url).toBe(`/api/files/${png.body.id}/content`);

    const content = await owner.get(png.body.url);
    expect(content.status).toBe(200);
    expect(content.headers['content-type']).toBe('image/png');
    expect(content.headers['x-content-type-options']).toBe('nosniff');
    expect(content.headers['content-security-policy']).toBe(
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    );
    expect(content.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(content.headers['content-disposition']).toContain('inline; filename="dot.png"');

    const meta = await owner.get<FileDto>(`/api/files/${png.body.id}`);
    expect(meta.body.id).toBe(png.body.id);

    const svg = await owner.upload<FileDto>(
      '/api/files',
      { buffer: SAFE_SVG, filename: 'box.svg', contentType: 'image/svg+xml' },
      { boardId: board.id },
    );
    expect(svg.status).toBe(201);
    expect(svg.body).toMatchObject({ mimeType: 'image/svg+xml', width: 40, height: 20 });

    // A text file pretending to be a PNG.
    const fake = await owner.upload(
      '/api/files',
      {
        buffer: Buffer.from('definitely not an image'),
        filename: 'x.png',
        contentType: 'image/png',
      },
      { boardId: board.id },
    );
    expect(fake.status).toBe(415);
    expect((fake.body as { error: { code: string } }).error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    // A PNG declared as JPEG.
    const mismatch = await owner.upload(
      '/api/files',
      { buffer: PNG_1X1, filename: 'x.jpg', contentType: 'image/jpeg' },
      { boardId: board.id },
    );
    expect(mismatch.status).toBe(415);
    // Malicious SVGs.
    for (const evil of [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="jav&#x09;ascript:alert(1)"><rect/></a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>',
      '<!DOCTYPE svg [<!ENTITY x "boom">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil.example/sprite.svg#a"/></svg>',
    ]) {
      const res = await owner.upload(
        '/api/files',
        { buffer: Buffer.from(evil), filename: 'evil.svg', contentType: 'image/svg+xml' },
        { boardId: board.id },
      );
      expect(res.status, evil).toBe(415);
    }

    // Only editors of the board may upload; strangers cannot read.
    const stranger = await signUp(t.url, 'File Stranger');
    const denied = await stranger.upload(
      '/api/files',
      { buffer: PNG_1X1, filename: 'dot.png', contentType: 'image/png' },
      { boardId: board.id },
    );
    expect(denied.status).toBe(404);
    expect((await stranger.get(png.body.url)).status).toBe(404);

    // Share-link viewers read content via ?st=.
    const link = await owner.post<ShareLinkDto>(`/api/boards/${board.id}/share-links`, {
      role: 'VIEWER',
    });
    const anon = new TestClient(t.url);
    expect((await anon.get(png.body.url, { query: { st: link.body.token } })).status).toBe(200);
    expect((await anon.get(png.body.url)).status).toBe(401);

    // Missing file / boardId.
    const noBoard = await owner.upload('/api/files', {
      buffer: PNG_1X1,
      filename: 'dot.png',
      contentType: 'image/png',
    });
    expect(noBoard.status).toBe(400);
  });

  it('supports client-generated ids and maintains file references', async () => {
    const owner = await signUp(t.url, 'Referencer');
    const board = await createBoard(owner);
    const otherBoard = await createBoard(owner, { title: 'Other' });
    const fileId = randomUUID();
    const clientId = 'files-client';

    // The image element is created before the upload finishes: accepted.
    const image = element('image', {
      id: 'img-1',
      fileId,
      status: 'pending',
      naturalWidth: 1,
      naturalHeight: 1,
    });
    const early = await owner.post<{ results: OpResult[] }>(`/api/boards/${board.id}/operations`, {
      clientId,
      batchId: 'b1',
      ops: [createOp(clientId, image)],
    });
    expect(early.body.results[0]!.status).toBe('applied');
    expect(await t.prisma.fileReference.count({ where: { boardId: board.id } })).toBe(0);

    const up = await owner.upload<FileDto>(
      '/api/files',
      { buffer: PNG_1X1, filename: 'a.png', contentType: 'image/png' },
      { boardId: board.id, fileId },
    );
    expect(up.status).toBe(201);
    expect(up.body.id).toBe(fileId);
    // Upload completion links the pending element.
    expect(
      await t.prisma.fileReference.findMany({
        where: { boardId: board.id },
        select: { elementId: true, fileId: true },
      }),
    ).toEqual([{ elementId: 'img-1', fileId }]);
    const detail = await owner.get<BoardDetailDto>(`/api/boards/${board.id}`);
    expect(Object.keys(detail.body.document.files)).toEqual([fileId]);
    expect(detail.body.document.files[fileId]).toMatchObject({
      id: fileId,
      mimeType: 'image/png',
      url: `/api/files/${fileId}/content`,
    });

    // Idempotent retry and conflicts.
    const retry = await owner.upload<FileDto>(
      '/api/files',
      { buffer: PNG_1X1, filename: 'a.png', contentType: 'image/png' },
      { boardId: board.id, fileId },
    );
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(fileId);
    const otherContent = await owner.upload(
      '/api/files',
      { buffer: Buffer.from(SAFE_SVG), filename: 'b.svg', contentType: 'image/svg+xml' },
      { boardId: board.id, fileId },
    );
    expect(otherContent.status).toBe(409);
    const otherBoardSameId = await owner.upload(
      '/api/files',
      { buffer: PNG_1X1, filename: 'a.png', contentType: 'image/png' },
      { boardId: otherBoard.id, fileId },
    );
    expect(otherBoardSameId.status).toBe(409);
    const badId = await owner.upload(
      '/api/files',
      { buffer: PNG_1X1, filename: 'a.png', contentType: 'image/png' },
      { boardId: board.id, fileId: 'nope' },
    );
    expect(badId.status).toBe(400);

    // An op pointing at a file of another board is rejected.
    const foreign = element('image', {
      id: 'img-2',
      fileId,
      status: 'saved',
      naturalWidth: 1,
      naturalHeight: 1,
    });
    const cross = await owner.post<{ results: OpResult[] }>(
      `/api/boards/${otherBoard.id}/operations`,
      {
        clientId,
        batchId: 'b2',
        ops: [createOp(clientId, foreign)],
      },
    );
    expect(cross.body.results[0]).toMatchObject({ status: 'rejected' });
    expect(cross.body.results[0]!.reason).toContain('another board');

    // Deleting the element drops its reference.
    await owner.post(`/api/boards/${board.id}/operations`, {
      clientId,
      batchId: 'b3',
      ops: [op(clientId, { type: 'DELETE_ELEMENT', elementId: 'img-1' })],
    });
    expect(await t.prisma.fileReference.count({ where: { boardId: board.id } })).toBe(0);

    // Duplicating copies file records (shared object) and remaps image elements.
    await owner.post(`/api/boards/${board.id}/operations`, {
      clientId,
      batchId: 'b4',
      ops: [
        op(clientId, { type: 'UPDATE_ELEMENT', elementId: 'img-1', patch: { isDeleted: false } }),
      ],
    });
    const dup = await owner.post<BoardSummaryDto>(`/api/boards/${board.id}/duplicate`);
    const dupDetail = await owner.get<BoardDetailDto>(`/api/boards/${dup.body.id}`);
    const dupImage = dupDetail.body.document.elements[0] as { fileId: string };
    expect(dupImage.fileId).not.toBe(fileId);
    expect(Object.keys(dupDetail.body.document.files)).toEqual([dupImage.fileId]);
    const [a, b] = await Promise.all([
      t.prisma.file.findUniqueOrThrow({ where: { id: fileId } }),
      t.prisma.file.findUniqueOrThrow({ where: { id: dupImage.fileId } }),
    ]);
    expect(a.storageKey).toBe(b.storageKey);
  });

  it('stores and serves board thumbnails', async () => {
    const owner = await signUp(t.url, 'Thumb');
    const board = await createBoard(owner);
    expect((await owner.get(`/api/boards/${board.id}/thumbnail`)).status).toBe(404);
    const put = await owner.upload(
      `/api/boards/${board.id}/thumbnail`,
      { buffer: PNG_1X1, filename: 't.png', contentType: 'image/png' },
      {},
      { method: 'put' },
    );
    expect(put.status).toBe(200);
    const svg = await owner.upload(
      `/api/boards/${board.id}/thumbnail`,
      { buffer: SAFE_SVG, filename: 't.svg', contentType: 'image/svg+xml' },
      {},
      { method: 'put' },
    );
    expect(svg.status).toBe(415);
    const summary = await owner.get<BoardDetailDto>(`/api/boards/${board.id}`);
    expect(summary.body.board.thumbnailUrl).toMatch(
      new RegExp(`^/api/boards/${board.id}/thumbnail\\?v=`),
    );
    const img = await owner.get(`/api/boards/${board.id}/thumbnail`);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
  });
});
