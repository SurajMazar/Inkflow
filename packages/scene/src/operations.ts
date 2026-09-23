import {
  isBindingElement,
  validateElement,
  type ElementPatch,
  type SceneElement,
} from '@inkflow/elements';
import { z } from 'zod';
import { applyPatch, patchKeys } from './delta';
import type { ElementChange } from './transaction';

export const OPERATION_TYPES = [
  'CREATE_ELEMENT',
  'UPDATE_ELEMENT',
  'DELETE_ELEMENT',
  'MOVE_ELEMENT',
  'RESIZE_ELEMENT',
  'ROTATE_ELEMENT',
  'GROUP_ELEMENTS',
  'UNGROUP_ELEMENTS',
  'CREATE_CONNECTION',
  'DELETE_CONNECTION',
] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

export interface OperationMeta {
  /** Globally unique operation id (idempotency key together with clientId). */
  opId: string;
  /** Id of the editor session that produced the operation. */
  clientId: string;
  /** Monotonic per-client counter, used to order a client's own operations. */
  clientSeq: number;
  /** Client wall clock at creation (informational only; never used for ordering). */
  timestamp: number;
  /** Element version the change was based on, for conflict detection. */
  baseVersion: number | null;
}

export type OperationBody =
  | { type: 'CREATE_ELEMENT'; element: SceneElement }
  | { type: 'CREATE_CONNECTION'; element: SceneElement }
  | { type: 'UPDATE_ELEMENT'; elementId: string; patch: ElementPatch }
  | { type: 'MOVE_ELEMENT'; elementId: string; x: number; y: number }
  | {
      type: 'RESIZE_ELEMENT';
      elementId: string;
      x: number;
      y: number;
      width: number;
      height: number;
      /** Other properties that change with size (points, fontSize, crop…). */
      patch: ElementPatch;
    }
  | { type: 'ROTATE_ELEMENT'; elementId: string; angle: number; x: number; y: number }
  | { type: 'DELETE_ELEMENT'; elementId: string }
  | { type: 'DELETE_CONNECTION'; elementId: string }
  | { type: 'GROUP_ELEMENTS'; elementIds: string[]; groupId: string }
  | { type: 'UNGROUP_ELEMENTS'; elementIds: string[]; groupId: string };

export type Operation = OperationMeta & OperationBody;

/** Operation as ordered and persisted by the server. */
export type SequencedOperation = Operation & {
  /** Board-wide sequence number assigned by the server. */
  seq: number;
  userId: string | null;
};

const id = z.string().min(1).max(128);
const finite = z.number().finite();
const patch = z.record(z.string().max(64), z.unknown());
const meta = {
  opId: id,
  clientId: id,
  clientSeq: z.number().int().min(0),
  timestamp: finite,
  baseVersion: z.number().int().nullable(),
};

/** Structural validation of untrusted operations (element contents are validated on apply). */
export const operationSchema = z.discriminatedUnion('type', [
  z.object({
    ...meta,
    type: z.literal('CREATE_ELEMENT'),
    element: z.record(z.string(), z.unknown()),
  }),
  z.object({
    ...meta,
    type: z.literal('CREATE_CONNECTION'),
    element: z.record(z.string(), z.unknown()),
  }),
  z.object({ ...meta, type: z.literal('UPDATE_ELEMENT'), elementId: id, patch }),
  z.object({ ...meta, type: z.literal('MOVE_ELEMENT'), elementId: id, x: finite, y: finite }),
  z.object({
    ...meta,
    type: z.literal('RESIZE_ELEMENT'),
    elementId: id,
    x: finite,
    y: finite,
    width: finite.min(0),
    height: finite.min(0),
    patch,
  }),
  z.object({
    ...meta,
    type: z.literal('ROTATE_ELEMENT'),
    elementId: id,
    angle: finite,
    x: finite,
    y: finite,
  }),
  z.object({ ...meta, type: z.literal('DELETE_ELEMENT'), elementId: id }),
  z.object({ ...meta, type: z.literal('DELETE_CONNECTION'), elementId: id }),
  z.object({
    ...meta,
    type: z.literal('GROUP_ELEMENTS'),
    elementIds: z.array(id).min(1).max(10_000),
    groupId: id,
  }),
  z.object({
    ...meta,
    type: z.literal('UNGROUP_ELEMENTS'),
    elementIds: z.array(id).min(1).max(10_000),
    groupId: id,
  }),
]);

/** Element ids an operation touches. */
export function operationTargets(op: OperationBody): string[] {
  switch (op.type) {
    case 'CREATE_ELEMENT':
    case 'CREATE_CONNECTION':
      return [op.element.id];
    case 'GROUP_ELEMENTS':
    case 'UNGROUP_ELEMENTS':
      return op.elementIds;
    default:
      return [op.elementId];
  }
}

/** Properties a client may never set through a patch. */
const PROTECTED_PATCH_KEYS = new Set(['id', 'type', 'version', 'versionNonce']);

function sanitizePatch(p: ElementPatch): ElementPatch {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) if (!PROTECTED_PATCH_KEYS.has(k)) out[k] = v;
  return out as ElementPatch;
}

/** Deterministic 31-bit hash of a string (used for reproducible version nonces). */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 1 || 1;
}

export interface ApplyResult {
  /** New element states produced by the operation. */
  elements: SceneElement[];
  /** Set when the operation could not be applied; the rest of the batch continues. */
  rejected: string | null;
  /** True when the element had been modified since `baseVersion` (merged per property). */
  conflicted: boolean;
}

export interface ApplyOptions {
  /** Validate resulting elements against the schema (always enabled on the server). */
  validate: boolean;
  /** Timestamp to stamp into `updated`; defaults to the operation timestamp. */
  now?: number;
}

/**
 * Applies an operation to the current element states. Conflict policy: operations are applied in
 * server sequence order and merge per property (last writer wins per property); deletes are
 * tombstones and win over concurrent property edits unless explicitly revived by `isDeleted: false`.
 */
export function applyOperation(
  getElement: (id: string) => SceneElement | undefined,
  op: Operation,
  options: ApplyOptions = { validate: true },
): ApplyResult {
  const stamp = options.now ?? op.timestamp;
  const finalize = (current: SceneElement | undefined, next: SceneElement): SceneElement => ({
    ...next,
    version: Math.max(current?.version ?? 0, next.version ?? 0) + 1,
    versionNonce: hashString(`${op.opId}:${next.id}`),
    updated: stamp,
  });
  const check = (els: SceneElement[]): ApplyResult => {
    if (options.validate) {
      for (const el of els) {
        const res = validateElement(el);
        if (!res.success)
          return {
            elements: [],
            rejected: `Invalid element ${el.id}: ${res.error}`,
            conflicted: false,
          };
      }
    }
    const conflicted = targetsConflict(getElement, op);
    return { elements: els, rejected: null, conflicted };
  };

  switch (op.type) {
    case 'CREATE_ELEMENT':
    case 'CREATE_CONNECTION': {
      const incoming = op.element;
      if (op.type === 'CREATE_CONNECTION' && !isBindingElement(incoming)) {
        return {
          elements: [],
          rejected: 'CREATE_CONNECTION requires an arrow or connector',
          conflicted: false,
        };
      }
      const current = getElement(incoming.id);
      if (current && current.type !== incoming.type) {
        return {
          elements: [],
          rejected: `Element ${incoming.id} already exists with another type`,
          conflicted: false,
        };
      }
      return check([finalize(current, { ...incoming, isDeleted: false })]);
    }
    case 'DELETE_ELEMENT':
    case 'DELETE_CONNECTION': {
      const current = getElement(op.elementId);
      if (!current) return { elements: [], rejected: null, conflicted: false }; // idempotent
      return check([finalize(current, { ...current, isDeleted: true })]);
    }
    case 'UPDATE_ELEMENT':
    case 'MOVE_ELEMENT':
    case 'RESIZE_ELEMENT':
    case 'ROTATE_ELEMENT': {
      const current = getElement(op.elementId);
      if (!current)
        return {
          elements: [],
          rejected: `Element ${op.elementId} does not exist`,
          conflicted: false,
        };
      let p: ElementPatch;
      if (op.type === 'UPDATE_ELEMENT') p = sanitizePatch(op.patch);
      else if (op.type === 'MOVE_ELEMENT') p = { x: op.x, y: op.y };
      else if (op.type === 'RESIZE_ELEMENT')
        p = { ...sanitizePatch(op.patch), x: op.x, y: op.y, width: op.width, height: op.height };
      else p = { angle: op.angle, x: op.x, y: op.y };
      // A concurrent delete wins unless this operation explicitly revives the element.
      if (current.isDeleted && p.isDeleted !== false) p = { ...p, isDeleted: true };
      return check([finalize(current, applyPatch(current, p))]);
    }
    case 'GROUP_ELEMENTS':
    case 'UNGROUP_ELEMENTS': {
      const out: SceneElement[] = [];
      for (const elementId of op.elementIds) {
        const current = getElement(elementId);
        if (!current) continue;
        const has = current.groupIds.includes(op.groupId);
        let groupIds = current.groupIds;
        if (op.type === 'GROUP_ELEMENTS' && !has) groupIds = [...current.groupIds, op.groupId];
        if (op.type === 'UNGROUP_ELEMENTS' && has)
          groupIds = current.groupIds.filter((g) => g !== op.groupId);
        if (groupIds !== current.groupIds) out.push(finalize(current, { ...current, groupIds }));
      }
      return check(out);
    }
  }
}

function targetsConflict(
  getElement: (id: string) => SceneElement | undefined,
  op: Operation,
): boolean {
  if (op.baseVersion === null) return false;
  return operationTargets(op).some((id) => {
    const el = getElement(id);
    return !!el && el.version > op.baseVersion!;
  });
}

const MOVE_KEYS = new Set(['x', 'y']);
const ROTATE_KEYS = new Set(['angle', 'x', 'y']);
const RESIZE_EXTRA_KEYS = new Set(['points', 'fontSize', 'crop', 'flipX', 'flipY', 'waypoints']);

type MetaFactory = (baseVersion: number | null) => OperationMeta;

/** Converts the net effect of a committed transaction into semantic collaboration operations. */
export function changesToOperations(
  changes: readonly ElementChange[],
  makeMeta: MetaFactory,
): Operation[] {
  const ops: Operation[] = [];
  const groupAdds = new Map<string, string[]>();
  const groupRemoves = new Map<string, string[]>();

  for (const { before, after } of changes) {
    const baseVersion = before ? before.version : null;
    if (!before || (before.isDeleted && !after.isDeleted)) {
      const type =
        isBindingElement(after) && after.type === 'connector'
          ? 'CREATE_CONNECTION'
          : 'CREATE_ELEMENT';
      ops.push({ ...makeMeta(baseVersion), type, element: after });
      continue;
    }
    if (!before.isDeleted && after.isDeleted) {
      ops.push({
        ...makeMeta(baseVersion),
        type: after.type === 'connector' ? 'DELETE_CONNECTION' : 'DELETE_ELEMENT',
        elementId: after.id,
      });
      continue;
    }
    const changed = changedKeys(before, after);
    if (changed.length === 0) continue;

    if (changed.length === 1 && changed[0] === 'groupIds') {
      const added = after.groupIds.filter((g) => !before.groupIds.includes(g));
      const removed = before.groupIds.filter((g) => !after.groupIds.includes(g));
      const appendedOnly =
        added.length === 1 && removed.length === 0 && after.groupIds.at(-1) === added[0];
      if (appendedOnly) {
        groupAdds.set(added[0]!, [...(groupAdds.get(added[0]!) ?? []), after.id]);
        continue;
      }
      if (added.length === 0 && removed.length === 1) {
        groupRemoves.set(removed[0]!, [...(groupRemoves.get(removed[0]!) ?? []), after.id]);
        continue;
      }
    }
    if (changed.every((k) => MOVE_KEYS.has(k))) {
      ops.push({
        ...makeMeta(baseVersion),
        type: 'MOVE_ELEMENT',
        elementId: after.id,
        x: after.x,
        y: after.y,
      });
      continue;
    }
    if (changed.includes('angle') && changed.every((k) => ROTATE_KEYS.has(k))) {
      ops.push({
        ...makeMeta(baseVersion),
        type: 'ROTATE_ELEMENT',
        elementId: after.id,
        angle: after.angle,
        x: after.x,
        y: after.y,
      });
      continue;
    }
    const sizeChanged = changed.includes('width') || changed.includes('height');
    if (
      sizeChanged &&
      changed.every(
        (k) => MOVE_KEYS.has(k) || k === 'width' || k === 'height' || RESIZE_EXTRA_KEYS.has(k),
      )
    ) {
      const extra: Record<string, unknown> = {};
      for (const k of changed)
        if (RESIZE_EXTRA_KEYS.has(k)) extra[k] = (after as unknown as Record<string, unknown>)[k];
      ops.push({
        ...makeMeta(baseVersion),
        type: 'RESIZE_ELEMENT',
        elementId: after.id,
        x: after.x,
        y: after.y,
        width: after.width,
        height: after.height,
        patch: extra as ElementPatch,
      });
      continue;
    }
    const p: Record<string, unknown> = {};
    for (const k of changed) p[k] = (after as unknown as Record<string, unknown>)[k];
    ops.push({
      ...makeMeta(baseVersion),
      type: 'UPDATE_ELEMENT',
      elementId: after.id,
      patch: p as ElementPatch,
    });
  }
  for (const [groupId, elementIds] of groupAdds) {
    ops.push({ ...makeMeta(null), type: 'GROUP_ELEMENTS', elementIds, groupId });
  }
  for (const [groupId, elementIds] of groupRemoves) {
    ops.push({ ...makeMeta(null), type: 'UNGROUP_ELEMENTS', elementIds, groupId });
  }
  return ops;
}

function changedKeys(before: SceneElement, after: SceneElement): string[] {
  const keys: string[] = [];
  const b = before as unknown as Record<string, unknown>;
  const a = after as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (k === 'version' || k === 'versionNonce' || k === 'updated' || k === 'id') continue;
    if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) keys.push(k);
  }
  return keys;
}

/** Builds a transient full-state patch operation for live previews (not persisted). */
export function elementToTransientOperation(el: SceneElement, meta: OperationMeta): Operation {
  const { id: _id, type: _type, ...rest } = el;
  return { ...meta, type: 'UPDATE_ELEMENT', elementId: el.id, patch: rest as ElementPatch };
}

export { patchKeys };
