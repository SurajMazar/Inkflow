import type { Bounds } from './bounds';

interface Entry {
  bounds: Bounds;
  /** Cell keys this entry is registered in; null for oversized entries kept in the large list. */
  cells: string[] | null;
}

/**
 * Uniform-grid spatial hash. Ideal for whiteboard scenes where most elements are small relative
 * to the viewport. Elements covering more than `maxCellsPerEntry` cells are stored in a separate
 * list that every query scans, which keeps inserts O(1) for huge frames/backgrounds.
 */
export class SpatialIndex {
  private readonly cells = new Map<string, Set<string>>();
  private readonly entries = new Map<string, Entry>();
  private readonly large = new Set<string>();

  constructor(
    private readonly cellSize = 256,
    private readonly maxCellsPerEntry = 64,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  getBounds(id: string): Bounds | undefined {
    return this.entries.get(id)?.bounds;
  }

  insert(id: string, bounds: Bounds): void {
    if (this.entries.has(id)) this.remove(id);
    if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.maxX)) {
      this.entries.set(id, { bounds, cells: null });
      this.large.add(id);
      return;
    }
    const x0 = Math.floor(bounds.minX / this.cellSize);
    const y0 = Math.floor(bounds.minY / this.cellSize);
    const x1 = Math.floor(bounds.maxX / this.cellSize);
    const y1 = Math.floor(bounds.maxY / this.cellSize);
    const count = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (count > this.maxCellsPerEntry) {
      this.entries.set(id, { bounds, cells: null });
      this.large.add(id);
      return;
    }
    const keys: string[] = [];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = `${cx}:${cy}`;
        let cell = this.cells.get(key);
        if (!cell) {
          cell = new Set();
          this.cells.set(key, cell);
        }
        cell.add(id);
        keys.push(key);
      }
    }
    this.entries.set(id, { bounds, cells: keys });
  }

  update(id: string, bounds: Bounds): void {
    const existing = this.entries.get(id);
    if (
      existing &&
      existing.bounds.minX === bounds.minX &&
      existing.bounds.minY === bounds.minY &&
      existing.bounds.maxX === bounds.maxX &&
      existing.bounds.maxY === bounds.maxY
    ) {
      return;
    }
    this.insert(id, bounds);
  }

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.cells) {
      for (const key of entry.cells) {
        const cell = this.cells.get(key);
        if (!cell) continue;
        cell.delete(id);
        if (cell.size === 0) this.cells.delete(key);
      }
    } else {
      this.large.delete(id);
    }
    this.entries.delete(id);
  }

  clear(): void {
    this.cells.clear();
    this.entries.clear();
    this.large.clear();
  }

  /** Ids whose bounds intersect the query bounds. */
  search(query: Bounds): string[] {
    const result = new Set<string>();
    const x0 = Math.floor(query.minX / this.cellSize);
    const y0 = Math.floor(query.minY / this.cellSize);
    const x1 = Math.floor(query.maxX / this.cellSize);
    const y1 = Math.floor(query.maxY / this.cellSize);
    const cellCount = (x1 - x0 + 1) * (y1 - y0 + 1);
    const intersects = (b: Bounds) =>
      b.minX <= query.maxX && b.maxX >= query.minX && b.minY <= query.maxY && b.maxY >= query.minY;

    if (!Number.isFinite(cellCount) || cellCount > this.cells.size) {
      // Query spans more cells than exist: scanning entries directly is cheaper.
      for (const [id, entry] of this.entries) if (intersects(entry.bounds)) result.add(id);
      return [...result];
    }
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const cell = this.cells.get(`${cx}:${cy}`);
        if (!cell) continue;
        for (const id of cell) {
          if (result.has(id)) continue;
          if (intersects(this.entries.get(id)!.bounds)) result.add(id);
        }
      }
    }
    for (const id of this.large) {
      if (intersects(this.entries.get(id)!.bounds)) result.add(id);
    }
    return [...result];
  }

  searchPoint(x: number, y: number, tolerance = 0): string[] {
    return this.search({
      minX: x - tolerance,
      minY: y - tolerance,
      maxX: x + tolerance,
      maxY: y + tolerance,
    });
  }
}
