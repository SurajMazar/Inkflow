export interface BitmapEntry {
  canvas: CanvasImageSource & { width: number; height: number };
  /** Pixels per local unit. */
  scale: number;
  /** Local-space origin of the bitmap (top-left of the drawable's local bounds). */
  originX: number;
  originY: number;
  bytes: number;
  elementId: string;
}

/**
 * LRU cache of rasterized drawables keyed by `id|version|nonce|zoomBucket`, bounded by a memory
 * budget (4 bytes per pixel).
 */
export class BitmapCache {
  private readonly entries = new Map<string, BitmapEntry>();
  private readonly byElement = new Map<string, Set<string>>();
  private bytes = 0;

  constructor(readonly budgetBytes = 96 * 1024 * 1024) {}

  get size(): number {
    return this.entries.size;
  }

  get usedBytes(): number {
    return this.bytes;
  }

  get(key: string): BitmapEntry | undefined {
    const entry = this.entries.get(key);
    if (entry) {
      // Refresh LRU position.
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry;
  }

  /** Any bitmap of this element version (any zoom bucket) — used while panning in low fidelity. */
  findAny(prefix: string, elementId: string): BitmapEntry | undefined {
    const keys = this.byElement.get(elementId);
    if (!keys) return undefined;
    let best: BitmapEntry | undefined;
    for (const k of keys) {
      if (!k.startsWith(prefix)) continue;
      const e = this.entries.get(k);
      if (e && (!best || e.scale > best.scale)) best = e;
    }
    return best;
  }

  set(key: string, entry: BitmapEntry): void {
    if (entry.bytes > this.budgetBytes) return;
    this.deleteKey(key);
    this.entries.set(key, entry);
    let keys = this.byElement.get(entry.elementId);
    if (!keys) {
      keys = new Set();
      this.byElement.set(entry.elementId, keys);
    }
    keys.add(key);
    this.bytes += entry.bytes;
    for (const [k] of this.entries) {
      if (this.bytes <= this.budgetBytes) break;
      if (k === key) continue;
      this.deleteKey(k);
    }
  }

  private deleteKey(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    this.entries.delete(key);
    this.bytes -= e.bytes;
    const keys = this.byElement.get(e.elementId);
    if (keys) {
      keys.delete(key);
      if (keys.size === 0) this.byElement.delete(e.elementId);
    }
  }

  /** Drops every bitmap of an element (all versions and zoom buckets). */
  deleteElement(elementId: string): void {
    const keys = this.byElement.get(elementId);
    if (!keys) return;
    for (const k of [...keys]) this.deleteKey(k);
  }

  clear(): void {
    this.entries.clear();
    this.byElement.clear();
    this.bytes = 0;
  }
}
