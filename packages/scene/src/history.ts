import type { ElementPatch, SceneElement } from '@inkflow/elements';

export interface HistoryDelta {
  id: string;
  /** Properties to restore on undo. */
  before: ElementPatch;
  /** Properties to restore on redo. */
  after: ElementPatch;
  /** Full element after the change; used to recreate elements missing from the scene. */
  snapshot: SceneElement;
}

export interface HistoryEntry {
  id: number;
  label: string;
  deltas: HistoryDelta[];
  selectionBefore: string[];
  selectionAfter: string[];
  timestamp: number;
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
}

/**
 * Undo/redo stacks of property-level deltas. Undo restores only the properties a change touched,
 * so concurrent edits by collaborators to other properties are preserved (per-property LWW).
 */
export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private nextId = 1;
  private readonly listeners = new Set<(state: HistoryState) => void>();

  constructor(private readonly limit = 200) {}

  get state(): HistoryState {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: this.undoStack.at(-1)?.label ?? null,
      redoLabel: this.redoStack.at(-1)?.label ?? null,
    };
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  subscribe(listener: (state: HistoryState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  record(entry: Omit<HistoryEntry, 'id' | 'timestamp'>): HistoryEntry {
    const full: HistoryEntry = { ...entry, id: this.nextId++, timestamp: Date.now() };
    this.undoStack.push(full);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.notify();
    return full;
  }

  /**
   * Merges deltas into the latest entry (e.g. consecutive typing or nudges). The earliest `before`
   * and the latest `after` of each property are kept.
   */
  mergeIntoLast(deltas: HistoryDelta[], selectionAfter: string[]): boolean {
    const last = this.undoStack.at(-1);
    if (!last) return false;
    for (const delta of deltas) {
      const existing = last.deltas.find((d) => d.id === delta.id);
      if (!existing) {
        last.deltas.push(delta);
        continue;
      }
      existing.before = { ...delta.before, ...existing.before };
      existing.after = { ...existing.after, ...delta.after };
      existing.snapshot = delta.snapshot;
    }
    last.selectionAfter = selectionAfter;
    this.redoStack = [];
    this.notify();
    return true;
  }

  peekUndo(): HistoryEntry | undefined {
    return this.undoStack.at(-1);
  }

  undo(): HistoryEntry | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    this.notify();
    return entry;
  }

  redo(): HistoryEntry | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    this.notify();
    return entry;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }

  private notify() {
    const state = this.state;
    for (const l of this.listeners) l(state);
  }
}
