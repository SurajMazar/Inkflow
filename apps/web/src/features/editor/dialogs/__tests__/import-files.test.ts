import { createElement, getCommonBounds, type FileMetadata } from '@inkflow/elements';
import { PNG_SIGNATURE, SCENE_KEYWORD, makeITXtChunk, makePngChunk } from '@inkflow/exporters';
import { DEFAULT_DOCUMENT_APP_STATE, serializeDocument } from '@inkflow/scene';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestEditor } from '../../panels/__tests__/test-session';
import { importFilesIntoEditor } from '../import-files';

const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
/** Minimal valid PNG: signature, IHDR (320×200 RGBA) and IEND with correct CRCs. */
const PNG_BYTES = new Uint8Array([
  ...PNG_SIGNATURE,
  ...makePngChunk('IHDR', new Uint8Array([...be32(320), ...be32(200), 8, 6, 0, 0, 0])),
  ...makePngChunk('IEND', new Uint8Array()),
]);
const PNG_DATA_URL = `data:image/png;base64,${btoa(String.fromCharCode(...PNG_BYTES))}`;

function setup(options: { readOnly?: boolean } = {}) {
  const editor = createTestEditor([], options);
  const uploadImage = vi.fn(async (file: File, fileId: string): Promise<FileMetadata> => ({
    id: fileId,
    mimeType: file.type,
    url: `/api/files/${fileId}/content`,
    width: 320,
    height: 200,
    size: file.size,
    created: 0,
  }));
  editor.host = { uploadImage };
  const insertImages = vi.spyOn(editor, 'insertImageFiles').mockResolvedValue(undefined);
  const addElements = vi.spyOn(editor, 'addElements');
  return { editor, uploadImage, insertImages, addElements };
}

const nativeFile = (name = 'board.inkflow') => {
  const rect = createElement('rectangle', { id: 'orig-rect', x: 0, y: 0, width: 100, height: 50 });
  const text = createElement('text', {
    id: 'orig-text',
    x: 20,
    y: 10,
    width: 40,
    height: 20,
    text: 'Hi',
  });
  return new File(
    [JSON.stringify(serializeDocument([rect, text], DEFAULT_DOCUMENT_APP_STATE, {}))],
    name,
    { type: 'application/json' },
  );
};

beforeEach(() => {
  vi.spyOn(toast, 'success');
  vi.spyOn(toast, 'error');
});

describe('importFilesIntoEditor', () => {
  it('inserts native files as new, selected elements centered at the drop point', async () => {
    const { editor, insertImages } = setup();
    await importFilesIntoEditor(editor, [nativeFile()], { x: 500, y: 400 });

    const els = editor.getElements();
    expect(els).toHaveLength(2);
    expect(els.map((e) => e.id)).not.toContain('orig-rect');
    const b = getCommonBounds(els)!;
    expect((b.minX + b.maxX) / 2).toBeCloseTo(500);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(400);
    expect(editor.state.selectedIds).toEqual(els.map((e) => e.id));
    expect(insertImages).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Imported 2 elements', expect.anything());
  });

  it('converts Excalidraw files and re-uploads their embedded images', async () => {
    const { editor, uploadImage } = setup();
    const excalidraw = {
      type: 'excalidraw',
      version: 2,
      elements: [
        {
          id: 'r1',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 100,
          height: 60,
          angle: 0,
          strokeColor: '#1e1e1e',
          backgroundColor: 'transparent',
          groupIds: [],
          seed: 1,
          version: 1,
          versionNonce: 1,
          isDeleted: false,
        },
        {
          id: 'img1',
          type: 'image',
          x: 200,
          y: 0,
          width: 160,
          height: 100,
          angle: 0,
          groupIds: [],
          seed: 2,
          version: 1,
          versionNonce: 1,
          isDeleted: false,
          fileId: 'file1',
          status: 'saved',
          scale: [1, 1],
        },
      ],
      files: { file1: { id: 'file1', mimeType: 'image/png', dataURL: PNG_DATA_URL, created: 1 } },
    };
    await importFilesIntoEditor(editor, [
      new File([JSON.stringify(excalidraw)], 'sketch.excalidraw'),
    ]);

    const els = editor.getElements();
    expect(els.map((e) => e.type).sort()).toEqual(['image', 'rectangle']);
    const img = els.find((e) => e.type === 'image');
    if (img?.type !== 'image') throw new Error('expected an image');
    expect(img.fileId).not.toBe('file1');
    expect(uploadImage).toHaveBeenCalledTimes(1);
    const [file, fileId] = uploadImage.mock.calls[0]!;
    expect(fileId).toBe(img.fileId);
    expect(file.type).toBe('image/png');
    expect(editor.files[img.fileId!]!.url).toBe(`/api/files/${img.fileId}/content`);
    expect((editor.getElement(img.id) as typeof img).status).toBe('saved');
  });

  it('inserts plain images through the editor image pipeline', async () => {
    const { editor, insertImages, addElements } = setup();
    const png = new File([PNG_BYTES], 'photo.png', { type: 'image/png' });
    const jpg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])], 'photo.jpg', {
      type: 'image/jpeg',
    });
    await importFilesIntoEditor(editor, [png, jpg], { x: 10, y: 20 });
    expect(insertImages).toHaveBeenCalledWith([png, jpg], { x: 10, y: 20 });
    expect(addElements).not.toHaveBeenCalled();
  });

  it('restores the scene embedded in an exported PNG', async () => {
    const { editor, insertImages } = setup();
    const doc = serializeDocument(
      [createElement('ellipse', { id: 'e1', x: 0, y: 0, width: 80, height: 80 })],
      DEFAULT_DOCUMENT_APP_STATE,
      {},
    );
    // Uncompressed iTXt chunk (jsdom's Blob has no stream() for CompressionStream).
    const scene = await makeITXtChunk(SCENE_KEYWORD, JSON.stringify(doc), false);
    const bytes = new Uint8Array([
      ...PNG_BYTES.subarray(0, PNG_BYTES.length - 12),
      ...scene,
      ...PNG_BYTES.subarray(PNG_BYTES.length - 12),
    ]);
    await importFilesIntoEditor(editor, [
      new File([bytes as BlobPart], 'export.png', { type: 'image/png' }),
    ]);
    expect(insertImages).not.toHaveBeenCalled();
    expect(editor.getElements().map((e) => e.type)).toEqual(['ellipse']);
  });

  it('converts SVG markup into elements, and falls back to an image when nothing converts', async () => {
    const { editor, insertImages } = setup();
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect x="10" y="10" width="80" height="40" fill="#ff0000"/><script>alert(1)</script></svg>';
    await importFilesIntoEditor(editor, [new File([svg], 'shape.svg', { type: 'image/svg+xml' })]);
    expect(editor.getElements().length).toBeGreaterThan(0);
    expect(insertImages).not.toHaveBeenCalled();

    const empty = new File(
      ['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'],
      'empty.svg',
      { type: 'image/svg+xml' },
    );
    await importFilesIntoEditor(editor, [empty]);
    expect(insertImages).toHaveBeenCalledWith([empty], undefined);
  });

  it('builds diagrams from Mermaid files', async () => {
    const { editor } = setup();
    await importFilesIntoEditor(editor, [
      new File(['flowchart LR\n  A[Start] --> B[End]'], 'flow.mmd', { type: 'text/plain' }),
    ]);
    const types = editor.getElements().map((e) => e.type);
    expect(types.filter((t) => t === 'node')).toHaveLength(2);
    expect(types).toContain('connector');
  });

  it('reports unsupported files without inserting anything', async () => {
    const { editor, insertImages } = setup();
    await importFilesIntoEditor(editor, [
      new File([new Uint8Array([1, 2, 3, 4])], 'archive.zip', { type: 'application/zip' }),
    ]);
    expect(editor.getElements()).toHaveLength(0);
    expect(insertImages).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Couldn't import archive.zip", expect.anything());
  });

  it('refuses to import into a read-only board', async () => {
    const { editor, insertImages, addElements } = setup({ readOnly: true });
    await importFilesIntoEditor(editor, [
      nativeFile(),
      new File([PNG_BYTES], 'a.png', { type: 'image/png' }),
    ]);
    expect(addElements).not.toHaveBeenCalled();
    expect(insertImages).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('You can only view this board', expect.anything());
  });
});
