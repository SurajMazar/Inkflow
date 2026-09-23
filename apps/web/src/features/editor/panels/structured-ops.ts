import { measureTable, measureUmlClass } from '@inkflow/diagram-engine';
import type {
  ElementPatch,
  SequenceElement,
  TableColumn,
  TableElement,
  UmlClassElement,
} from '@inkflow/elements';
import { generateId } from '@inkflow/shared';

export type StructuredElement = TableElement | UmlClassElement | SequenceElement;

export function isStructuredElement(
  el: { type: string } | null | undefined,
): el is StructuredElement {
  return !!el && (el.type === 'table' || el.type === 'uml-class' || el.type === 'sequence');
}

/** Moves the item at `from` by `delta` positions (clamped). */
export function moveItem<T>(list: readonly T[], from: number, delta: number): T[] {
  const to = Math.max(0, Math.min(list.length - 1, from + delta));
  if (from < 0 || from >= list.length || to === from) return list.slice();
  const out = list.slice();
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item!);
  return out;
}

// ───────────── tables ─────────────

type TableChanges = Partial<Pick<TableElement, 'name' | 'columns' | 'headerColor'>>;

/** Patch for a table model change, including the size that fits the new content. */
export function tablePatch(el: TableElement, changes: TableChanges): ElementPatch {
  const size = measureTable({ ...el, ...changes });
  return { ...changes, width: size.width, height: size.height };
}

export function newTableColumn(existing: readonly TableColumn[]): TableColumn {
  const names = new Set(existing.map((c) => c.name));
  let n = existing.length + 1;
  while (names.has(`column_${n}`)) n++;
  return {
    id: generateId(10),
    name: `column_${n}`,
    dataType: 'text',
    primaryKey: false,
    foreignKey: false,
    nullable: true,
    unique: false,
    references: null,
  };
}

export const tableColumnOps = {
  add: (el: TableElement): ElementPatch =>
    tablePatch(el, { columns: [...el.columns, newTableColumn(el.columns)] }),
  update: (
    el: TableElement,
    columnId: string,
    patch: Partial<Omit<TableColumn, 'id'>>,
  ): ElementPatch => {
    const columns = el.columns.map((c) => {
      if (c.id !== columnId) return c;
      const next = { ...c, ...patch };
      // Primary keys are never nullable; a column without FK has no reference.
      if (patch.primaryKey) next.nullable = false;
      if (patch.foreignKey === false) next.references = null;
      return next;
    });
    return tablePatch(el, { columns });
  },
  remove: (el: TableElement, columnId: string): ElementPatch =>
    tablePatch(el, { columns: el.columns.filter((c) => c.id !== columnId) }),
  move: (el: TableElement, columnId: string, delta: number): ElementPatch =>
    tablePatch(el, {
      columns: moveItem(
        el.columns,
        el.columns.findIndex((c) => c.id === columnId),
        delta,
      ),
    }),
};

// ───────────── UML classes ─────────────

type UmlChanges = Partial<
  Pick<UmlClassElement, 'name' | 'stereotype' | 'isAbstract' | 'attributes' | 'methods'>
>;

export function umlPatch(el: UmlClassElement, changes: UmlChanges): ElementPatch {
  const size = measureUmlClass({ ...el, ...changes });
  return { ...changes, width: size.width, height: size.height };
}

// ───────────── sequence diagrams ─────────────

/** Patch that replaces the sequence model with `next` (already resized by `sequenceOps`). */
export function sequencePatch(next: SequenceElement): ElementPatch {
  return {
    participants: next.participants,
    messages: next.messages,
    notes: next.notes,
    width: next.width,
    height: next.height,
  };
}
