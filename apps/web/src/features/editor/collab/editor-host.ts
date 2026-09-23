import type { EditorHost } from '@inkflow/canvas-engine';
import type { FileMetadata, SceneElement } from '@inkflow/elements';
import { detectImportKind, importExcalidraw, importMermaid, importSvgAsElements } from '@inkflow/importers';
import { ApiError, type FileDto } from '@inkflow/shared';
import { api, uploadWithProgress } from '@/lib/api';
import { localStore } from '../persistence/local-store';

export function fileDtoToMetadata(dto: FileDto, shareToken: string | null): FileMetadata {
  return {
    id: dto.id,
    mimeType: dto.mimeType,
    url: api.files.contentUrl(dto.id, shareToken),
    width: dto.width ?? 0,
    height: dto.height ?? 0,
    size: dto.size,
    created: Date.parse(dto.createdAt) || Date.now(),
  };
}

function isNetworkError(error: unknown): boolean {
  return error instanceof ApiError ? error.code === 'SERVICE_UNAVAILABLE' : error instanceof TypeError;
}

function waitForOnline(): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.onLine) return new Promise((r) => setTimeout(r, 5000));
  return new Promise((resolve) => window.addEventListener('online', () => resolve(), { once: true }));
}

/** Uploads a board image under a client-chosen id; retries while offline (the blob is kept in IndexedDB). */
export async function uploadBoardImage(
  boardId: string,
  shareToken: string | null,
  blob: Blob,
  fileId: string,
  name: string,
): Promise<FileMetadata> {
  await localStore.queueUpload({ fileId, boardId, blob, name, type: blob.type }).catch(() => undefined);
  for (let attempt = 0; ; attempt++) {
    try {
      const form = new FormData();
      form.append('boardId', boardId);
      form.append('fileId', fileId);
      form.append('file', blob, name);
      const dto = await uploadWithProgress<FileDto>('/files', form, { shareToken });
      await localStore.removeUpload(fileId).catch(() => undefined);
      return fileDtoToMetadata(dto, shareToken);
    } catch (error) {
      if (!isNetworkError(error) || attempt > 50) {
        await localStore.removeUpload(fileId).catch(() => undefined);
        throw error;
      }
      await waitForOnline();
    }
  }
}

function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish([...(input.files ?? [])]));
    input.addEventListener('cancel', () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}

export const pickImageFiles = () => pickFiles('image/png,image/jpeg,image/webp,image/gif,image/svg+xml', true);
export const pickImportFile = () =>
  pickFiles('.inkflow,.json,.excalidraw,.svg,.png,.jpg,.jpeg,.webp,.gif,.mmd,.mermaid,.txt,application/json,image/*', false);

/** Converts pasted rich text (SVG markup, Mermaid, Excalidraw clipboard) into editable elements. */
export async function transformPastedText(text: string): Promise<SceneElement[] | null> {
  const head = text.trimStart().slice(0, 400);
  const kind = detectImportKind('clipboard', 'text/plain', head);
  try {
    if (kind === 'svg') {
      const res = importSvgAsElements(text);
      return res.elements.length ? res.elements : null;
    }
    if (kind === 'mermaid') {
      const res = importMermaid(text);
      return res.elements.length ? res.elements : null;
    }
    if (kind === 'excalidraw' || head.includes('"excalidraw/clipboard"')) {
      const parsed = importExcalidraw(JSON.parse(text));
      return parsed.document.elements.length ? parsed.document.elements : null;
    }
  } catch (error) {
    console.warn('[inkflow] pasted content could not be converted', error);
  }
  return null;
}

export function createEditorHost(
  boardId: string,
  shareToken: string | null,
  handlers: Pick<EditorHost, 'onUiRequest' | 'onError'>,
  getFiles: () => Record<string, FileMetadata>,
): EditorHost {
  return {
    uploadImage: (file, fileId) => uploadBoardImage(boardId, shareToken, file, fileId, file.name),
    resolveFileUrl: (fileId) => getFiles()[fileId]?.url ?? api.files.contentUrl(fileId, shareToken),
    pickImages: pickImageFiles,
    transformPastedText,
    ...handlers,
  };
}
