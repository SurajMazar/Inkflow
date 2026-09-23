import type { ImageSource } from '../types';

type Status = 'loading' | 'loaded' | 'error' | 'missing';

export interface ImageCacheOptions {
  /** URL of a file (server URL or data URL); null when the file is unknown. */
  resolveUrl: (fileId: string) => string | null;
  /** Called once an image finished decoding (re-render the scene). */
  onLoad?: (fileId: string) => void;
  crossOrigin?: 'use-credentials' | 'anonymous';
}

interface Entry {
  status: Status;
  image: CanvasImageSource | null;
  element: HTMLImageElement | null;
}

/** Decoded image store for image elements; loads lazily through `ensure()`. */
export class ImageCache implements ImageSource {
  private readonly entries = new Map<string, Entry>();
  private disposed = false;

  constructor(private readonly options: ImageCacheOptions) {}

  /** Starts loading a file if it is not loaded/loading yet (errors are not retried automatically). */
  ensure(fileId: string): void {
    if (this.disposed) return;
    const existing = this.entries.get(fileId);
    if (existing && existing.status !== 'missing') return;
    const url = this.options.resolveUrl(fileId);
    if (!url) {
      this.entries.set(fileId, { status: 'missing', image: null, element: null });
      return;
    }
    if (typeof Image === 'undefined') {
      this.entries.set(fileId, { status: 'error', image: null, element: null });
      return;
    }
    const img = new Image();
    const entry: Entry = { status: 'loading', image: null, element: img };
    this.entries.set(fileId, entry);
    if (this.options.crossOrigin && !url.startsWith('data:') && !url.startsWith('blob:')) {
      img.crossOrigin = this.options.crossOrigin;
    }
    img.decoding = 'async';
    const finish = (ok: boolean) => {
      img.onload = null;
      img.onerror = null;
      if (this.disposed || this.entries.get(fileId) !== entry) return;
      entry.status = ok ? 'loaded' : 'error';
      entry.image = ok ? img : null;
      entry.element = null;
      if (ok) this.options.onLoad?.(fileId);
    };
    img.onload = () => {
      if (typeof img.decode === 'function') {
        img.decode().then(
          () => finish(true),
          () => finish(img.naturalWidth > 0),
        );
      } else {
        finish(true);
      }
    };
    img.onerror = () => finish(false);
    img.src = url;
  }

  /** Registers an already decoded image (pasted files, tests, workers). */
  set(fileId: string, image: CanvasImageSource): void {
    const prev = this.entries.get(fileId);
    if (prev?.element) {
      prev.element.onload = null;
      prev.element.onerror = null;
    }
    this.entries.set(fileId, { status: 'loaded', image, element: null });
  }

  get(fileId: string): CanvasImageSource | null {
    return this.entries.get(fileId)?.image ?? null;
  }

  status(fileId: string): Status {
    return this.entries.get(fileId)?.status ?? 'missing';
  }

  /** Forgets a file (e.g. to retry after an error). */
  delete(fileId: string): void {
    const prev = this.entries.get(fileId);
    if (prev?.element) {
      prev.element.onload = null;
      prev.element.onerror = null;
    }
    this.entries.delete(fileId);
  }

  dispose(): void {
    this.disposed = true;
    for (const e of this.entries.values()) {
      if (e.element) {
        e.element.onload = null;
        e.element.onerror = null;
        e.element.src = '';
      }
    }
    this.entries.clear();
  }
}
