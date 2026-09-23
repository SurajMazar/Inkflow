import type { Editor } from '@inkflow/canvas-engine';
import type { FileMetadata, SceneElement } from '@inkflow/elements';
import { SCENE_KEYWORD, extractSceneFromSvg, readTextFromPng } from '@inkflow/exporters';
import type { Point } from '@inkflow/geometry';
import {
  detectImportKind,
  importExcalidraw,
  importMermaid,
  importNativeJson,
  importSvgAsElements,
  type ImportKind,
} from '@inkflow/importers';
import type { ParsedDocument } from '@inkflow/scene';
import { ALLOWED_IMAGE_MIME_TYPES } from '@inkflow/shared';
import { notify } from '@/features/notifications/notify';
import { formatIssue, insertElementSet, viewportCenterWorld } from '../panels/insert-elements';

const HEAD_BYTES = 8192;
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,([A-Za-z0-9+/=\s]+)$/;

/** Result of reading one file: an element set to insert, or an image to insert as a picture. */
export type ReadImportResult =
  | {
      type: 'elements';
      kind: ImportKind;
      elements: SceneElement[];
      files: Record<string, FileMetadata>;
      issues: string[];
    }
  | { type: 'image' };

/** `Blob.text()` with a FileReader fallback (older browsers, jsdom). */
function readText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read'));
    reader.readAsText(blob);
  });
}

/** `Blob.arrayBuffer()` with a FileReader fallback. */
async function readBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read'));
    reader.readAsArrayBuffer(blob);
  });
}

function readHead(file: File): Promise<string> {
  return readText(file.slice(0, HEAD_BYTES));
}

/** Scene JSON embedded in a PNG exported with "embed scene", or null. */
async function sceneFromPng(file: File): Promise<string | null> {
  try {
    return await readTextFromPng(await readBytes(file), SCENE_KEYWORD);
  } catch {
    return null;
  }
}

function isPng(file: File, head: string): boolean {
  return file.type === 'image/png' || /\.png$/i.test(file.name) || head.startsWith('PNG', 1);
}

function fromParsed(kind: ImportKind, parsed: ParsedDocument): ReadImportResult {
  return {
    type: 'elements',
    kind,
    elements: parsed.document.elements,
    files: parsed.document.files,
    issues: parsed.issues.map(formatIssue),
  };
}

/**
 * Reads a dropped or picked file and converts it into elements without executing anything it
 * contains: native/Excalidraw JSON is parsed and validated, SVG markup is tokenized and converted
 * (never inserted as live markup), PNGs are checked for an embedded Inkflow scene.
 */
export async function readImportFile(file: File): Promise<ReadImportResult> {
  const head = await readHead(file);
  const kind = detectImportKind(file.name, file.type, head);
  switch (kind) {
    case 'inkflow':
      return fromParsed('inkflow', importNativeJson(await readText(file)));
    case 'excalidraw': {
      let json: unknown;
      try {
        json = JSON.parse((await readText(file)).replace(/^\uFEFF/, ''));
      } catch {
        throw new Error('This file is not valid JSON.');
      }
      return fromParsed('excalidraw', importExcalidraw(json));
    }
    case 'svg': {
      const text = await readText(file);
      const embedded = extractSceneFromSvg(text);
      if (embedded) return fromParsed('inkflow', importNativeJson(embedded));
      const res = importSvgAsElements(text);
      if (res.elements.length === 0) return { type: 'image' };
      return {
        type: 'elements',
        kind,
        elements: res.elements,
        files: {},
        issues: res.issues.map(formatIssue),
      };
    }
    case 'image': {
      if (isPng(file, head)) {
        const embedded = await sceneFromPng(file);
        if (embedded) return fromParsed('inkflow', importNativeJson(embedded));
      }
      return { type: 'image' };
    }
    case 'mermaid': {
      const res = importMermaid(await readText(file));
      if (res.elements.length === 0)
        throw new Error(
          res.issues.map(formatIssue)[0] ?? 'No diagram could be read from this text.',
        );
      return {
        type: 'elements',
        kind,
        elements: res.elements,
        files: {},
        issues: res.issues.map(formatIssue),
      };
    }
    default:
      throw new Error(
        'This file type is not supported. Try .inkflow, .excalidraw, .svg, .png, .jpg or Mermaid (.mmd).',
      );
  }
}

function newFileId(): string {
  return globalThis.crypto.randomUUID();
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) return null;
  try {
    const binary = atob(m[2]!.replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: m[1] });
  } catch {
    return null;
  }
}

function isSameOriginFileUrl(url: string): boolean {
  if (url.startsWith('/api/files/')) return true;
  if (typeof window === 'undefined') return false;
  try {
    const u = new URL(url, window.location.href);
    return u.origin === window.location.origin && u.pathname.startsWith('/api/files/');
  } catch {
    return false;
  }
}

interface PendingUpload {
  fileId: string;
  blob: Blob;
  name: string;
}

/**
 * Resolves the image files an imported element set references. Embedded images (data URLs) get
 * a fresh file id, render immediately from the data URL and are uploaded to this board; images
 * already stored on this server are reused. Anything else is dropped (the image shows as missing).
 */
function prepareImageFiles(
  editor: Editor,
  elements: SceneElement[],
  files: Record<string, FileMetadata>,
): { elements: SceneElement[]; uploads: PendingUpload[]; dropped: number } {
  const remap = new Map<string, string | null>();
  const uploads: PendingUpload[] = [];
  let dropped = 0;
  for (const el of elements) {
    if (el.type !== 'image' || !el.fileId || remap.has(el.fileId)) continue;
    const fileId = el.fileId;
    if (editor.files[fileId]) {
      remap.set(fileId, fileId);
      continue;
    }
    const meta = files[fileId];
    const allowedMime =
      meta && (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(meta.mimeType);
    if (meta && allowedMime && meta.url.startsWith('data:')) {
      const blob = dataUrlToBlob(meta.url);
      if (!blob) {
        remap.set(fileId, null);
        dropped++;
        continue;
      }
      const id = newFileId();
      editor.registerFile({ ...meta, id, size: blob.size });
      uploads.push({
        fileId: id,
        blob,
        name: `image-${id.slice(0, 8)}.${blob.type.split('/')[1]?.replace('svg+xml', 'svg') ?? 'png'}`,
      });
      remap.set(fileId, id);
    } else if (meta && allowedMime && isSameOriginFileUrl(meta.url)) {
      editor.registerFile(meta);
      remap.set(fileId, fileId);
    } else {
      remap.set(fileId, null);
      dropped++;
    }
  }
  const out = elements.map((el) => {
    if (el.type !== 'image' || !el.fileId) return el;
    const mapped = remap.get(el.fileId);
    if (mapped === undefined || mapped === el.fileId) return el;
    return mapped === null
      ? { ...el, status: 'error' as const }
      : { ...el, fileId: mapped, status: 'pending' as const };
  });
  return { elements: out, uploads, dropped };
}

async function uploadImported(editor: Editor, uploads: PendingUpload[]): Promise<void> {
  const upload = editor.host.uploadImage;
  if (!upload || uploads.length === 0) return;
  await Promise.all(
    uploads.map(async ({ fileId, blob, name }) => {
      const ids = editor
        .getElements()
        .filter((e) => e.type === 'image' && e.fileId === fileId)
        .map((e) => e.id);
      const setStatus = (status: 'saved' | 'error') =>
        editor.mutate(
          'Image uploaded',
          (tx) =>
            ids.filter((id) => editor.getElement(id)).forEach((id) => tx.update(id, { status })),
          { history: false },
        );
      try {
        const meta = await upload(new File([blob], name, { type: blob.type }), fileId);
        editor.registerFile(meta);
        setStatus('saved');
      } catch (error) {
        setStatus('error');
        editor.host.onError?.(error, 'Upload image');
      }
    }),
  );
}

function describeIssues(issues: string[]): string | undefined {
  if (issues.length === 0) return undefined;
  const first = issues[0]!;
  return issues.length === 1
    ? `1 item was skipped: ${first}`
    : `${issues.length} items were skipped, e.g. ${first}`;
}

/**
 * Imports files into the open board (canvas drop, paste of files, import dialog). Element sets
 * are inserted as new elements centered at `at` (or the viewport center) and selected; plain
 * images are inserted and uploaded. Reports the result in a toast.
 */
export async function importFilesIntoEditor(
  editor: Editor,
  files: File[],
  at?: Point,
): Promise<void> {
  if (files.length === 0) return;
  if (editor.isReadOnly) {
    notify.error('You can only view this board', {
      description: 'Ask an owner for edit access to import files.',
    });
    return;
  }
  const center = at ?? viewportCenterWorld(editor);
  const step = 32 / Math.max(0.1, editor.state.viewport.zoom);
  const images: File[] = [];
  const createdIds: string[] = [];
  const issues: string[] = [];
  const uploads: PendingUpload[] = [];
  let imported = 0;

  for (const file of files) {
    let result: ReadImportResult;
    try {
      result = await readImportFile(file);
    } catch (error) {
      notify.error(`Couldn't import ${file.name}`, {
        description: error instanceof Error ? error.message : undefined,
      });
      continue;
    }
    if (result.type === 'image') {
      images.push(file);
      continue;
    }
    if (result.elements.length === 0) {
      notify.error(`Nothing to import from ${file.name}`, {
        description: describeIssues(result.issues) ?? 'The file contains no elements.',
      });
      continue;
    }
    const prepared = prepareImageFiles(editor, result.elements, result.files);
    const offset = imported * step;
    const created = insertElementSet(editor, prepared.elements, {
      at: { x: center.x + offset, y: center.y + offset },
      label: `Import ${file.name}`,
      select: false,
    });
    createdIds.push(...created.map((e) => e.id));
    uploads.push(...prepared.uploads);
    issues.push(...result.issues);
    if (prepared.dropped)
      issues.push(
        `${prepared.dropped} linked image${prepared.dropped === 1 ? '' : 's'} could not be imported`,
      );
    imported++;
  }

  if (createdIds.length) {
    editor.setState({ selectedIds: createdIds, editingGroupId: null });
    const what =
      imported === 1
        ? `${createdIds.length} elements`
        : `${imported} files (${createdIds.length} elements)`;
    notify.success(`Imported ${what}`, { description: describeIssues(issues) });
  }
  if (images.length)
    await editor.insertImageFiles(
      images,
      createdIds.length ? { x: center.x + imported * step, y: center.y + imported * step } : at,
    );
  if (uploads.length) await uploadImported(editor, uploads);
}
