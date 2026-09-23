import { createElement, type FileMetadata, type ImageElement } from '@inkflow/elements';
import type { Point } from '@inkflow/geometry';
import { ALLOWED_IMAGE_MIME_TYPES, MAX_UPLOAD_BYTES } from '@inkflow/shared';
import type { Editor } from './editor';

const MAX_INSERT_SIZE = 640;

function newFileId(): string {
  const c = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The image could not be decoded'));
    img.src = url;
  });
}

/** Inserts images immediately (local preview) and uploads them in the background. */
export async function insertImages(editor: Editor, files: readonly File[], center: Point): Promise<void> {
  const accepted: File[] = [];
  for (const file of files) {
    if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
      editor.requestUi({ type: 'toast', level: 'error', message: `${file.name}: unsupported image type` });
      continue;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      editor.requestUi({ type: 'toast', level: 'error', message: `${file.name}: larger than ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB` });
      continue;
    }
    accepted.push(file);
  }
  if (accepted.length === 0) return;
  const zoom = editor.state.viewport.zoom;
  const maxSize = Math.min(MAX_INSERT_SIZE, (editor.state.viewport.width * 0.6) / zoom);
  const prepared: { file: File; element: ImageElement; meta: FileMetadata }[] = [];
  let offset = 0;
  for (const file of accepted) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const nw = img.naturalWidth || 300;
      const nh = img.naturalHeight || 300;
      const scale = Math.min(1, maxSize / Math.max(nw, nh));
      const width = nw * scale;
      const height = nh * scale;
      const fileId = newFileId();
      editor.images.set(fileId, img);
      const meta: FileMetadata = { id: fileId, mimeType: file.type, url, width: nw, height: nh, size: file.size, created: Date.now() };
      const element = createElement('image', {
        x: center.x - width / 2 + offset,
        y: center.y - height / 2 + offset,
        width,
        height,
        fileId,
        status: 'pending',
        naturalWidth: nw,
        naturalHeight: nh,
        opacity: editor.state.style.opacity,
      });
      prepared.push({ file, element, meta });
      offset += 24 / zoom;
    } catch (error) {
      URL.revokeObjectURL(url);
      editor.requestUi({ type: 'toast', level: 'error', message: `${file.name}: ${(error as Error).message}` });
    }
  }
  if (prepared.length === 0) return;
  for (const p of prepared) editor.registerFile(p.meta);
  const created = editor.addElements(prepared.map((p) => p.element), { label: 'Insert image' });
  const upload = editor.host.uploadImage;
  if (!upload) return;
  await Promise.all(
    prepared.map(async ({ file, element }, i) => {
      const id = created[i]?.id ?? element.id;
      try {
        const meta = await upload(file, element.fileId!);
        editor.registerFile(meta);
        if (editor.scene.getElement(id)) editor.mutate('Image uploaded', (tx) => tx.update(id, { status: 'saved' }), { history: false });
      } catch (error) {
        if (editor.scene.getElement(id)) editor.mutate('Image upload failed', (tx) => tx.update(id, { status: 'error' }), { history: false });
        editor.host.onError?.(error, 'Upload image');
      }
    }),
  );
}
