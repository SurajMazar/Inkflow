import {
  getElementBounds,
  isLinearElement,
  type LinearElement,
  type SceneElement,
} from '@inkflow/elements';
import { SpatialIndex, type Bounds } from '@inkflow/geometry';
import { compareOrder } from './fractional-index';

export type ChangeSource = 'local' | 'remote' | 'history' | 'load' | 'transient';

export interface SceneChange {
  source: ChangeSource;
  /** Elements whose new version was applied (including tombstones). */
  elements: readonly SceneElement[];
  /** Monotonic scene version after the change. */
  sceneVersion: number;
}

export type SceneListener = (change: SceneChange) => void;

function addToIndex(index: Map<string, Set<string>>, key: string, id: string) {
  let set = index.get(key);
  if (!set) {
    set = new Set();
    index.set(key, set);
  }
  set.add(id);
}

function removeFromIndex(index: Map<string, Set<string>>, key: string, id: string) {
  const set = index.get(key);
  if (!set) return;
  set.delete(id);
  if (set.size === 0) index.delete(key);
}

/**
 * In-memory scene store. Holds every element (tombstones included, so undo and sync can revive
 * them), keeps them ordered by fractional index, and maintains derived indexes: spatial, binding
 * (target → linear elements attached to it), group membership and frame membership.
 */
export class Scene {
  private readonly map = new Map<string, SceneElement>();
  private readonly spatial = new SpatialIndex(256);
  private readonly bindings = new Map<string, Set<string>>();
  private readonly groups = new Map<string, Set<string>>();
  private readonly frames = new Map<string, Set<string>>();
  private readonly listeners = new Set<SceneListener>();
  private sortedAll: SceneElement[] | null = null;
  private sortedLive: SceneElement[] | null = null;
  private _version = 0;

  constructor(elements: readonly SceneElement[] = []) {
    if (elements.length) this.replaceAll(elements, 'load');
  }

  /** Increments on every change; cheap cache key for renderers and derived data. */
  get version(): number {
    return this._version;
  }

  get size(): number {
    return this.map.size;
  }

  subscribe(listener: SceneListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Any element by id, including deleted ones. */
  getElement(id: string): SceneElement | undefined {
    return this.map.get(id);
  }

  /** Non-deleted element by id. */
  getLiveElement(id: string): SceneElement | undefined {
    const el = this.map.get(id);
    return el && !el.isDeleted ? el : undefined;
  }

  getElementsMap(): ReadonlyMap<string, SceneElement> {
    return this.map;
  }

  /** All elements including tombstones, in z-order. */
  getElementsIncludingDeleted(): readonly SceneElement[] {
    if (!this.sortedAll) this.sortedAll = [...this.map.values()].sort(compareOrder);
    return this.sortedAll;
  }

  /** Non-deleted elements in z-order (bottom first). */
  getElements(): readonly SceneElement[] {
    if (!this.sortedLive)
      this.sortedLive = this.getElementsIncludingDeleted().filter((e) => !e.isDeleted);
    return this.sortedLive;
  }

  /** Non-deleted elements whose bounds intersect `bounds`, in z-order. */
  queryBounds(bounds: Bounds): SceneElement[] {
    const ids = this.spatial.search(bounds);
    const out: SceneElement[] = [];
    for (const id of ids) {
      const el = this.map.get(id);
      if (el && !el.isDeleted) out.push(el);
    }
    return out.sort(compareOrder);
  }

  queryPoint(x: number, y: number, tolerance: number): SceneElement[] {
    return this.queryBounds({
      minX: x - tolerance,
      minY: y - tolerance,
      maxX: x + tolerance,
      maxY: y + tolerance,
    });
  }

  /** Arrows/connectors attached to the element (either endpoint). */
  getBoundLinears(elementId: string): LinearElement[] {
    const ids = this.bindings.get(elementId);
    if (!ids) return [];
    const out: LinearElement[] = [];
    for (const id of ids) {
      const el = this.map.get(id);
      if (el && !el.isDeleted && isLinearElement(el)) out.push(el);
    }
    return out;
  }

  getGroupElements(groupId: string): SceneElement[] {
    const ids = this.groups.get(groupId);
    if (!ids) return [];
    return [...ids]
      .map((id) => this.map.get(id)!)
      .filter((e) => e && !e.isDeleted)
      .sort(compareOrder);
  }

  getFrameChildren(frameId: string): SceneElement[] {
    const ids = this.frames.get(frameId);
    if (!ids) return [];
    return [...ids]
      .map((id) => this.map.get(id)!)
      .filter((e) => e && !e.isDeleted)
      .sort(compareOrder);
  }

  getBounds(id: string): Bounds | undefined {
    return this.spatial.getBounds(id);
  }

  /** Replaces the whole scene content (board load, version restore). */
  replaceAll(elements: readonly SceneElement[], source: ChangeSource = 'load'): void {
    for (const el of this.map.values()) this.unindex(el);
    this.map.clear();
    this.spatial.clear();
    for (const el of elements) {
      this.map.set(el.id, el);
      this.index(el);
    }
    this.invalidate();
    this.emit(source, elements);
  }

  /** Inserts or replaces element versions. Callers are responsible for version bumps. */
  upsert(elements: readonly SceneElement[], source: ChangeSource): void {
    if (elements.length === 0) return;
    let orderChanged = false;
    for (const el of elements) {
      const prev = this.map.get(el.id);
      if (prev) {
        this.unindex(prev);
        if (prev.index !== el.index || prev.isDeleted !== el.isDeleted) orderChanged = true;
      } else {
        orderChanged = true;
      }
      this.map.set(el.id, el);
      this.index(el);
    }
    if (orderChanged) {
      this.invalidate();
    } else {
      // Order unchanged: patch cached arrays in place to avoid re-sorting on every drag frame.
      this.patchCaches(elements);
    }
    this.emit(source, elements);
  }

  /** Permanently removes elements (used only for purging tombstones). */
  purge(ids: readonly string[]): void {
    const removed: SceneElement[] = [];
    for (const id of ids) {
      const el = this.map.get(id);
      if (!el) continue;
      this.unindex(el);
      this.map.delete(id);
      removed.push({ ...el, isDeleted: true });
    }
    if (removed.length) {
      this.invalidate();
      this.emit('local', removed);
    }
  }

  private patchCaches(elements: readonly SceneElement[]) {
    const byId = new Map(elements.map((e) => [e.id, e]));
    const patch = (arr: SceneElement[] | null) => {
      if (!arr) return null;
      let copy: SceneElement[] | null = null;
      for (let i = 0; i < arr.length; i++) {
        const next = byId.get(arr[i]!.id);
        if (next) {
          copy ??= arr.slice();
          copy[i] = next;
        }
      }
      return copy ?? arr;
    };
    this.sortedAll = patch(this.sortedAll);
    this.sortedLive = patch(this.sortedLive);
  }

  private invalidate() {
    this.sortedAll = null;
    this.sortedLive = null;
  }

  private emit(source: ChangeSource, elements: readonly SceneElement[]) {
    this._version++;
    const change: SceneChange = { source, elements, sceneVersion: this._version };
    for (const listener of this.listeners) listener(change);
  }

  private index(el: SceneElement) {
    if (!el.isDeleted) this.spatial.insert(el.id, getElementBounds(el));
    if (isLinearElement(el)) {
      if (el.startBinding) addToIndex(this.bindings, el.startBinding.elementId, el.id);
      if (el.endBinding) addToIndex(this.bindings, el.endBinding.elementId, el.id);
    }
    for (const g of el.groupIds) addToIndex(this.groups, g, el.id);
    if (el.frameId) addToIndex(this.frames, el.frameId, el.id);
  }

  private unindex(el: SceneElement) {
    this.spatial.remove(el.id);
    if (isLinearElement(el)) {
      if (el.startBinding) removeFromIndex(this.bindings, el.startBinding.elementId, el.id);
      if (el.endBinding) removeFromIndex(this.bindings, el.endBinding.elementId, el.id);
    }
    for (const g of el.groupIds) removeFromIndex(this.groups, g, el.id);
    if (el.frameId) removeFromIndex(this.frames, el.frameId, el.id);
  }
}
