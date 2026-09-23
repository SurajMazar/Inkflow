import {
  createElement,
  getCommonBounds,
  isLinearElement,
  measureTextElement,
  validateElement,
  type ElementPatch,
  type FileMetadata,
  type SceneElement,
} from '@inkflow/elements';
import { boundsCenter, type Point } from '@inkflow/geometry';
import { duplicateElements, restoreElement } from '@inkflow/scene';
import type { Editor } from './editor';
import { isEditableTarget } from './interaction/controller';
import { viewportCenter } from './viewport';

export const CLIPBOARD_TYPE = 'inkflow/clipboard';

export interface ClipboardPayload {
  type: typeof CLIPBOARD_TYPE;
  version: 1;
  elements: SceneElement[];
  files: Record<string, FileMetadata>;
}

const STYLE_KEYS = [
  'strokeColor',
  'backgroundColor',
  'fillStyle',
  'strokeWidth',
  'strokeStyle',
  'roughness',
  'opacity',
  'roundness',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'textDecoration',
  'textAlign',
  'lineHeight',
  'letterSpacing',
  'startArrowhead',
  'endArrowhead',
] as const;

/**
 * Copy/cut/paste of elements (preserving groups, bindings, frames, styles and images), external
 * clipboard content (images, text, SVG/diagram text via the host), and style copy/paste.
 */
export class ClipboardManager {
  private memory: ClipboardPayload | null = null;
  private copiedStyle: ElementPatch | null = null;
  private pasteCount = 0;

  constructor(private readonly editor: Editor) {}

  attach(doc: Document): () => void {
    const shouldHandle = (e: ClipboardEvent) => {
      if (this.editor.state.textEdit) return false;
      if (isEditableTarget(e.target) || isEditableTarget(doc.activeElement)) return false;
      return true;
    };
    const onCopy = (e: ClipboardEvent) => {
      if (!shouldHandle(e) || this.editor.state.selectedIds.length === 0) return;
      const payload = this.buildPayload();
      if (!payload) return;
      e.clipboardData?.setData('text/plain', JSON.stringify(payload));
      this.memory = payload;
      e.preventDefault();
    };
    const onCut = (e: ClipboardEvent) => {
      if (!shouldHandle(e) || this.editor.state.selectedIds.length === 0 || this.editor.isReadOnly)
        return;
      onCopy(e);
      this.editor.deleteElements(this.editor.state.selectedIds, 'Cut');
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!shouldHandle(e) || this.editor.isReadOnly) return;
      const data = e.clipboardData;
      if (!data) return;
      const files = [...data.files].filter((f) => f.type.startsWith('image/'));
      const text = data.getData('text/plain');
      e.preventDefault();
      void this.pasteData({ text, files });
    };
    doc.addEventListener('copy', onCopy);
    doc.addEventListener('cut', onCut);
    doc.addEventListener('paste', onPaste);
    return () => {
      doc.removeEventListener('copy', onCopy);
      doc.removeEventListener('cut', onCut);
      doc.removeEventListener('paste', onPaste);
    };
  }

  /** Selected elements plus frame children and connectors fully inside the selection. */
  private collectForCopy(): SceneElement[] {
    const editor = this.editor;
    const ids = new Set(editor.state.selectedIds);
    for (const el of editor.getSelectedElements()) {
      if (el.type === 'frame') for (const c of editor.scene.getFrameChildren(el.id)) ids.add(c.id);
    }
    for (const id of [...ids]) {
      for (const linear of editor.scene.getBoundLinears(id)) {
        const s = linear.startBinding?.elementId;
        const t = linear.endBinding?.elementId;
        if (s && t && ids.has(s) && ids.has(t)) ids.add(linear.id);
      }
    }
    return editor.scene.getElements().filter((e) => ids.has(e.id));
  }

  buildPayload(): ClipboardPayload | null {
    const elements = this.collectForCopy();
    if (elements.length === 0) return null;
    const files: Record<string, FileMetadata> = {};
    for (const el of elements)
      if (el.type === 'image' && el.fileId && this.editor.files[el.fileId])
        files[el.fileId] = this.editor.files[el.fileId]!;
    return { type: CLIPBOARD_TYPE, version: 1, elements: structuredClone(elements), files };
  }

  /** Copies the selection using the async Clipboard API (menus/toolbar). */
  async copy(): Promise<void> {
    const payload = this.buildPayload();
    if (!payload) return;
    this.memory = payload;
    this.pasteCount = 0;
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload));
    } catch {
      // Clipboard permission denied: the in-memory clipboard still works inside this tab.
    }
  }

  async cut(): Promise<void> {
    if (this.editor.isReadOnly) return;
    await this.copy();
    this.editor.deleteElements(this.editor.state.selectedIds, 'Cut');
  }

  /** Pastes from the async Clipboard API, falling back to the in-memory clipboard. */
  async paste(options: { inPlace?: boolean } = {}): Promise<void> {
    if (this.editor.isReadOnly) return;
    let text = '';
    const files: File[] = [];
    try {
      if (navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find((t) => t.startsWith('image/'));
          if (imageType) {
            const blob = await item.getType(imageType);
            files.push(
              new File([blob], `pasted.${imageType.split('/')[1] ?? 'png'}`, { type: imageType }),
            );
          } else if (item.types.includes('text/plain')) {
            text = await (await item.getType('text/plain')).text();
          }
        }
      } else {
        text = await navigator.clipboard.readText();
      }
    } catch {
      if (this.memory) text = JSON.stringify(this.memory);
    }
    await this.pasteData({ text, files }, options);
  }

  async pasteData(
    data: { text?: string; files?: File[] },
    options: { inPlace?: boolean } = {},
  ): Promise<void> {
    const editor = this.editor;
    const target = this.pasteTarget();
    if (data.files && data.files.length) {
      await editor.insertImageFiles(data.files, target);
      return;
    }
    const text = data.text ?? '';
    if (!text.trim()) {
      if (this.memory) this.pastePayload(this.memory, target, options.inPlace ?? false);
      return;
    }
    const payload = parseClipboardPayload(text);
    if (payload) {
      this.pastePayload(payload, target, options.inPlace ?? false);
      return;
    }
    const transformed = editor.host.transformPastedText
      ? await editor.host.transformPastedText(text)
      : null;
    if (transformed && transformed.length) {
      this.placeElements(transformed, target, false);
      return;
    }
    this.pastePlainText(text, target);
  }

  private pasteTarget(): Point {
    return (
      this.editor.lastPointerWorld ??
      this.editor.screenToWorld(viewportCenter(this.editor.state.viewport))
    );
  }

  private pastePayload(payload: ClipboardPayload, target: Point, inPlace: boolean) {
    for (const [id, meta] of Object.entries(payload.files))
      if (!this.editor.files[id]) this.editor.registerFile(meta);
    this.pasteCount += 1;
    this.placeElements(payload.elements, target, inPlace);
  }

  private placeElements(elements: readonly SceneElement[], target: Point, inPlace: boolean) {
    const editor = this.editor;
    const valid = elements
      .map((e) => restoreElement(e))
      .filter((e): e is SceneElement => !!e && validateElement(e).success);
    if (valid.length === 0) return;
    const bounds = getCommonBounds(valid)!;
    const c = boundsCenter(bounds);
    const dx = inPlace ? 0 : target.x - c.x;
    const dy = inPlace ? 0 : target.y - c.y;
    const frameIds = new Set(editor.getFrames().map((f) => f.id));
    const { elements: copies } = duplicateElements(valid, {
      dx,
      dy,
      existingFrameIds: frameIds,
      keepExternalBindings: inPlace,
    });
    const created = editor.addElements(copies, { label: 'Paste' });
    // Keep connectors attached to their (copied) endpoints.
    const linearIds = created.filter(isLinearElement).map((e) => e.id);
    if (linearIds.length)
      editor.mutate(
        'Paste',
        (tx) =>
          editor.refreshBindings(
            tx,
            created.map((e) => e.id),
          ),
        { merge: true },
      );
  }

  private pastePlainText(text: string, target: Point) {
    const editor = this.editor;
    const trimmed = text.replace(/\r\n/g, '\n').slice(0, 20_000);
    const isUrl = /^https?:\/\/\S+$/i.test(trimmed.trim());
    const el = createElement('text', {
      ...(editor.styleProps('text') as object),
      text: trimmed,
      x: target.x,
      y: target.y,
    });
    const size = measureTextElement(el);
    const final = {
      ...el,
      width: size.width,
      height: size.height,
      x: target.x - size.width / 2,
      y: target.y - size.height / 2,
      link: isUrl ? trimmed.trim() : null,
    };
    editor.addElements([final], { label: 'Paste text' });
  }

  copyStyles(): void {
    const el = this.editor.getSelectedElements()[0];
    if (!el) return;
    const style: Record<string, unknown> = {};
    for (const key of STYLE_KEYS)
      if (key in el) style[key] = (el as unknown as Record<string, unknown>)[key];
    if ('label' in el && el.label && !isLinearElement(el)) {
      for (const key of [
        'fontFamily',
        'fontSize',
        'fontWeight',
        'fontStyle',
        'textDecoration',
        'textAlign',
      ] as const)
        style[key] ??= el.label[key];
    }
    this.copiedStyle = style as ElementPatch;
  }

  pasteStyles(): void {
    if (!this.copiedStyle) return;
    this.editor.applyStyle({}, this.copiedStyle);
  }

  get hasCopiedStyle(): boolean {
    return this.copiedStyle !== null;
  }
}

export function parseClipboardPayload(text: string): ClipboardPayload | null {
  if (!text.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(text) as Partial<ClipboardPayload>;
    if (parsed.type !== CLIPBOARD_TYPE || !Array.isArray(parsed.elements)) return null;
    return {
      type: CLIPBOARD_TYPE,
      version: 1,
      elements: parsed.elements,
      files: parsed.files ?? {},
    };
  } catch {
    return null;
  }
}
