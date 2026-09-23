import { bumpVersion, type ElementPatch, type SceneElement } from '@inkflow/elements';
import { applyPatch, diffElements } from './delta';
import type { HistoryDelta } from './history';
import type { ChangeSource, Scene } from './scene';

export interface ElementChange {
  /** State before the transaction; null when the element was created by it. */
  before: SceneElement | null;
  after: SceneElement;
}

export interface CommittedTransaction {
  label: string;
  deltas: HistoryDelta[];
  changes: ElementChange[];
}

/**
 * Groups element mutations into one atomic unit. Mutations are applied to the scene immediately
 * (so interactions render live) and are reported as a single change set on commit — e.g. an
 * entire drag becomes one history entry and one batch of persistent operations.
 */
export class Transaction {
  private readonly initial = new Map<string, SceneElement | null>();
  private readonly touched: string[] = [];
  private closed = false;

  constructor(
    private readonly scene: Scene,
    readonly label: string,
    private readonly liveSource: ChangeSource = 'local',
  ) {}

  get isOpen(): boolean {
    return !this.closed;
  }

  /** Ids touched so far, in first-touch order. */
  get touchedIds(): readonly string[] {
    return this.touched;
  }

  private remember(id: string) {
    if (this.initial.has(id)) return;
    const current = this.scene.getElement(id);
    this.initial.set(id, current ? current : null);
    this.touched.push(id);
  }

  private assertOpen() {
    if (this.closed) throw new Error(`Transaction "${this.label}" is already closed`);
  }

  /** Adds a new element (or revives an existing id) to the scene. */
  create(element: SceneElement): SceneElement {
    this.assertOpen();
    this.remember(element.id);
    const el = { ...element, isDeleted: false, updated: Date.now() };
    this.scene.upsert([el], this.liveSource);
    return el;
  }

  /** Applies a property patch; returns the updated element or undefined when missing. */
  update(id: string, patch: ElementPatch): SceneElement | undefined {
    return this.updateMany([[id, patch]])[0];
  }

  /** Applies several patches with a single scene notification. */
  updateMany(patches: readonly (readonly [string, ElementPatch])[]): (SceneElement | undefined)[] {
    this.assertOpen();
    const now = Date.now();
    const next: SceneElement[] = [];
    const results = patches.map(([id, patch]) => {
      const current = this.scene.getElement(id);
      if (!current) return undefined;
      this.remember(id);
      const updated = bumpVersion(applyPatch(current, patch), now);
      next.push(updated);
      return updated;
    });
    this.scene.upsert(next, this.liveSource);
    return results;
  }

  delete(ids: readonly string[]): void {
    this.updateMany(ids.map((id) => [id, { isDeleted: true }] as const));
  }

  /** Reverts all changes applied through this transaction. */
  rollback(): void {
    if (this.closed) return;
    this.closed = true;
    const restore: SceneElement[] = [];
    const purge: string[] = [];
    for (const [id, before] of this.initial) {
      if (before) restore.push(bumpVersion(before));
      else purge.push(id);
    }
    if (restore.length) this.scene.upsert(restore, 'local');
    if (purge.length) this.scene.purge(purge);
  }

  /** Closes the transaction and returns its net effect, or null when nothing changed. */
  commit(): CommittedTransaction | null {
    if (this.closed) return null;
    this.closed = true;
    const deltas: HistoryDelta[] = [];
    const changes: ElementChange[] = [];
    for (const id of this.touched) {
      const before = this.initial.get(id) ?? null;
      const after = this.scene.getElement(id);
      if (!after) continue;
      if (!before) {
        if (after.isDeleted) continue; // created and deleted within the same transaction
        deltas.push({
          id,
          before: { isDeleted: true },
          after: { isDeleted: false },
          snapshot: after,
        });
        changes.push({ before: null, after });
        continue;
      }
      const diff = diffElements(before, after);
      if (!diff) continue;
      deltas.push({ id, before: diff.before, after: diff.after, snapshot: after });
      changes.push({ before, after });
    }
    if (deltas.length === 0) return null;
    return { label: this.label, deltas, changes };
  }
}
