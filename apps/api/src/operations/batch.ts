import type { OpResult, ServerChange } from '@inkflow/collaboration';
import type { SceneElement } from '@inkflow/elements';
import { applyOperation, operationSchema, operationTargets, type Operation } from '@inkflow/scene';
import { hasNulChar, imageFileId } from '../documents/board-document.service';

/** Hard cap on live (non-deleted) elements per board. */
export const MAX_BOARD_ELEMENTS = 100_000;

export interface ParsedOp {
  index: number;
  op: Operation | null;
  opId: string;
  /** Reason when the op failed structural validation. */
  invalid: string | null;
}

/** Structural validation of an untrusted batch; invalid entries are reported, not thrown. */
export function parseOps(raw: unknown[], clientId: string): ParsedOp[] {
  return raw.map((value, index) => {
    const opId =
      value && typeof value === 'object' && typeof (value as { opId?: unknown }).opId === 'string'
        ? String((value as { opId: string }).opId).slice(0, 128)
        : `invalid-${index}`;
    const result = operationSchema.safeParse(value);
    if (!result.success) {
      const issue = result.error.issues[0];
      return { index, op: null, opId, invalid: `Invalid operation: ${issue ? `${issue.path.join('.')} ${issue.message}` : 'malformed'}` };
    }
    const op = result.data as Operation;
    if (op.clientId !== clientId) return { index, op: null, opId, invalid: 'Operation clientId does not match the connection' };
    return { index, op, opId: op.opId, invalid: null };
  });
}

/** Element ids a batch needs loaded. */
export function batchTargets(ops: Operation[]): string[] {
  const ids = new Set<string>();
  for (const op of ops) for (const id of operationTargets(op)) ids.add(id);
  return [...ids];
}

export interface FileLookup {
  /** Board id owning the file, or null when the file does not exist (yet). */
  boardOf(fileId: string): string | null;
}

export interface PlannedBatch {
  results: OpResult[];
  /** Applied operations in order with their assigned sequence numbers. */
  applied: { op: Operation; seq: number; elements: SceneElement[] }[];
  /** Final state of every element changed by the batch. */
  finalStates: Map<string, SceneElement>;
  /** Change in the number of live elements. */
  liveDelta: number;
  lastSeq: number;
}

export interface PlanInput {
  boardId: string;
  startSeq: number;
  liveCount: number;
  /** Current persisted states of the batch targets. */
  current: Map<string, SceneElement>;
  ops: ParsedOp[];
  /** opId → seq of operations already persisted for this client (idempotency). */
  duplicates: Map<string, number>;
  files: FileLookup;
  now: number;
}

/**
 * Applies a batch in memory. Each operation sees the results of the previous ones; a rejected
 * operation does not abort the batch. Pure: persistence happens in the caller's transaction.
 */
export function planBatch(input: PlanInput): PlannedBatch {
  const state = new Map(input.current);
  const initialLive = new Map<string, boolean>();
  for (const [id, el] of input.current) initialLive.set(id, !el.isDeleted);
  const results: OpResult[] = [];
  const applied: PlannedBatch['applied'] = [];
  /** opIds handled earlier in this batch → their seq (null when rejected). */
  const seen = new Map<string, number | null>();
  let seq = input.startSeq;
  let live = input.liveCount;

  for (const parsed of input.ops) {
    if (!parsed.op) {
      results.push({ opId: parsed.opId, status: 'rejected', seq: null, reason: parsed.invalid ?? 'Invalid operation' });
      continue;
    }
    const op = parsed.op;
    const dupSeq = input.duplicates.get(op.opId);
    if (dupSeq !== undefined) {
      results.push({ opId: op.opId, status: 'duplicate', seq: dupSeq });
      continue;
    }
    if (seen.has(op.opId)) {
      results.push({ opId: op.opId, status: 'duplicate', seq: seen.get(op.opId) ?? null });
      continue;
    }
    seen.set(op.opId, null);

    const outcome = applyOperation((id) => state.get(id), op, { validate: true, now: input.now });
    if (outcome.rejected) {
      results.push({ opId: op.opId, status: 'rejected', seq: null, reason: outcome.rejected });
      continue;
    }
    const reason = checkResultingElements(outcome.elements, state, input.boardId, input.files);
    if (reason) {
      results.push({ opId: op.opId, status: 'rejected', seq: null, reason });
      continue;
    }
    let nextLive = live;
    for (const el of outcome.elements) {
      const before = state.get(el.id);
      const wasLive = !!before && !before.isDeleted;
      if (wasLive !== !el.isDeleted) nextLive += el.isDeleted ? -1 : 1;
    }
    if (nextLive > MAX_BOARD_ELEMENTS && nextLive > live) {
      results.push({ opId: op.opId, status: 'rejected', seq: null, reason: `Boards are limited to ${MAX_BOARD_ELEMENTS} elements` });
      continue;
    }
    live = nextLive;
    for (const el of outcome.elements) state.set(el.id, el);
    seq += 1;
    applied.push({ op, seq, elements: outcome.elements });
    seen.set(op.opId, seq);
    results.push({ opId: op.opId, status: 'applied', seq });
  }

  const finalStates = new Map<string, SceneElement>();
  for (const { elements } of applied) for (const el of elements) finalStates.set(el.id, state.get(el.id)!);
  let liveDelta = 0;
  for (const [id, el] of finalStates) {
    const was = initialLive.get(id) ?? false;
    if (was !== !el.isDeleted) liveDelta += el.isDeleted ? -1 : 1;
  }
  return { results, applied, finalStates, liveDelta, lastSeq: seq };
}

/** Server-side checks beyond the element schema. Returns a rejection reason or null. */
export function checkResultingElements(
  elements: SceneElement[],
  state: Map<string, SceneElement>,
  boardId: string,
  files: FileLookup,
): string | null {
  for (const el of elements) {
    if (hasNulChar(el)) return `Element ${el.id} contains NUL characters`;
    if (el.type !== 'image') continue;
    const fileId = imageFileId(el);
    if (!fileId) continue;
    const before = state.get(el.id);
    const previous = before ? imageFileId(before) : null;
    if (previous === fileId) continue;
    const owner = files.boardOf(fileId);
    // Unknown files are accepted (upload in flight); files of other boards are not.
    if (owner !== null && owner !== boardId) return `File ${fileId} belongs to another board`;
  }
  return null;
}

/** File ids that resulting image elements might reference (for prefetching ownership). */
export function candidateFileIds(ops: Operation[]): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(lower)) ids.add(lower);
    }
  };
  for (const op of ops) {
    if (op.type === 'CREATE_ELEMENT' || op.type === 'CREATE_CONNECTION') {
      visit((op.element as { fileId?: unknown }).fileId);
    } else if (op.type === 'UPDATE_ELEMENT' || op.type === 'RESIZE_ELEMENT') {
      visit((op.patch as { fileId?: unknown }).fileId);
    }
  }
  return [...ids];
}

export function toServerChanges(
  applied: PlannedBatch['applied'],
  clientId: string,
  userId: string | null,
): ServerChange[] {
  return applied.map(({ op, seq, elements }) => ({
    seq,
    opId: op.opId,
    clientId,
    userId,
    type: op.type,
    elements,
  }));
}
