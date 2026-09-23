import { sequenceOps } from '@inkflow/diagram-engine';
import type {
  ElementPatch,
  SequenceElement,
  SequenceMessageKind,
  SequenceParticipantKind,
  TableColumn,
  TableElement,
  UmlClassElement,
} from '@inkflow/elements';
import { Button, Checkbox, EmptyState, Label, NativeSelect, cn } from '@inkflow/ui';
import { ArrowDown, ArrowUp, Plus, Table, Trash2 } from 'lucide-react';
import * as React from 'react';
import { ColorPicker } from '../components/ColorPicker';
import { useBoardSession, useEditorState, useSelectedElements } from '../hooks/editor-context';
import { CommitInput } from './CommitInput';
import {
  isStructuredElement,
  moveItem,
  sequencePatch,
  tableColumnOps,
  tablePatch,
  umlPatch,
  type StructuredElement,
} from './structured-ops';

const HEADER_COLORS = ['#e7f5ff', '#ebfbee', '#fff9db', '#fff4e6', '#f3f0ff', '#f1f3f5'] as const;
const PARTICIPANT_KINDS: SequenceParticipantKind[] = [
  'participant',
  'actor',
  'database',
  'boundary',
  'control',
  'entity',
];
const MESSAGE_KINDS: { value: SequenceMessageKind; label: string }[] = [
  { value: 'sync', label: 'Sync →' },
  { value: 'async', label: 'Async ⇢' },
  { value: 'return', label: 'Return ⇠' },
  { value: 'create', label: 'Create' },
  { value: 'destroy', label: 'Destroy ×' },
];

type Apply = (patch: ElementPatch, label: string) => void;

function IconButton({
  label,
  onClick,
  disabled,
  children,
  testId,
}: {
  label: string;
  onClick(): void;
  disabled?: boolean;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function ReorderButtons({
  index,
  count,
  name,
  onMove,
  onRemove,
  disabled,
}: {
  index: number;
  count: number;
  name: string;
  onMove(delta: number): void;
  onRemove(): void;
  disabled: boolean;
}) {
  return (
    <div className="flex shrink-0">
      <IconButton
        label={`Move ${name} up`}
        disabled={disabled || index === 0}
        onClick={() => onMove(-1)}
      >
        <ArrowUp className="size-3.5" />
      </IconButton>
      <IconButton
        label={`Move ${name} down`}
        disabled={disabled || index === count - 1}
        onClick={() => onMove(1)}
      >
        <ArrowDown className="size-3.5" />
      </IconButton>
      <IconButton label={`Remove ${name}`} disabled={disabled} onClick={onRemove}>
        <Trash2 className="size-3.5" />
      </IconButton>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 border-b p-3" aria-label={title}>
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function FlagToggle({
  label,
  short,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  short: string;
  checked: boolean;
  onChange(v: boolean): void;
  disabled: boolean;
}) {
  return (
    <label
      className={cn('flex items-center gap-1 text-[11px]', disabled && 'opacity-50')}
      title={label}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        disabled={disabled}
        aria-label={label}
        className="size-3.5"
      />
      {short}
    </label>
  );
}

// ───────────── table ─────────────

function ColumnEditor({
  el,
  col,
  index,
  apply,
  disabled,
}: {
  el: TableElement;
  col: TableColumn;
  index: number;
  apply: Apply;
  disabled: boolean;
}) {
  const update = (patch: Partial<Omit<TableColumn, 'id'>>, label = 'Edit column') =>
    apply(tableColumnOps.update(el, col.id, patch), label);
  return (
    <li className="space-y-1.5 rounded-md border p-2" data-testid="table-column">
      <div className="flex items-center gap-1">
        <CommitInput
          value={col.name}
          onCommit={(name) => update({ name }, 'Rename column')}
          normalize={(v) => v.trim() || null}
          aria-label={`Column ${index + 1} name`}
          placeholder="name"
          disabled={disabled}
          className="font-mono"
          data-testid="column-name"
        />
        <CommitInput
          value={col.dataType}
          onCommit={(dataType) => update({ dataType }, 'Change column type')}
          aria-label={`Column ${index + 1} type`}
          placeholder="type"
          disabled={disabled}
          className="w-24 shrink-0 font-mono"
          data-testid="column-type"
        />
        <ReorderButtons
          index={index}
          count={el.columns.length}
          name={`column ${col.name}`}
          disabled={disabled}
          onMove={(d) => apply(tableColumnOps.move(el, col.id, d), 'Reorder columns')}
          onRemove={() => apply(tableColumnOps.remove(el, col.id), 'Remove column')}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <FlagToggle
          label="Primary key"
          short="PK"
          checked={col.primaryKey}
          disabled={disabled}
          onChange={(v) => update({ primaryKey: v })}
        />
        <FlagToggle
          label="Foreign key"
          short="FK"
          checked={col.foreignKey}
          disabled={disabled}
          onChange={(v) => update({ foreignKey: v })}
        />
        <FlagToggle
          label="Nullable"
          short="Null"
          checked={col.nullable}
          disabled={disabled || col.primaryKey}
          onChange={(v) => update({ nullable: v })}
        />
        <FlagToggle
          label="Unique"
          short="Unique"
          checked={col.unique}
          disabled={disabled}
          onChange={(v) => update({ unique: v })}
        />
      </div>
      {col.foreignKey && (
        <CommitInput
          value={col.references ?? ''}
          onCommit={(v) => update({ references: v || null }, 'Change reference')}
          aria-label={`Column ${index + 1} references`}
          placeholder="references table.column"
          disabled={disabled}
          className="font-mono"
        />
      )}
    </li>
  );
}

function TableEditor({
  el,
  apply,
  disabled,
}: {
  el: TableElement;
  apply: Apply;
  disabled: boolean;
}) {
  return (
    <>
      <Section title="Table">
        <Field label="Name">
          <CommitInput
            value={el.name}
            onCommit={(name) => apply(tablePatch(el, { name }), 'Rename table')}
            normalize={(v) => v.trim() || null}
            disabled={disabled}
            data-testid="table-name"
          />
        </Field>
        {!disabled && (
          <ColorPicker
            label="Header color"
            value={el.headerColor}
            quick={HEADER_COLORS}
            onChange={(headerColor) =>
              apply(tablePatch(el, { headerColor }), 'Change header color')
            }
          />
        )}
      </Section>
      <Section
        title={`Columns (${el.columns.length})`}
        action={
          !disabled && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => apply(tableColumnOps.add(el), 'Add column')}
              data-testid="table-add-column"
            >
              <Plus className="size-3.5" /> Add
            </Button>
          )
        }
      >
        {el.columns.length === 0 ? (
          <p className="text-xs text-muted-foreground">No columns yet.</p>
        ) : (
          <ul className="space-y-2">
            {el.columns.map((col, i) => (
              <ColumnEditor
                key={col.id}
                el={el}
                col={col}
                index={i}
                apply={apply}
                disabled={disabled}
              />
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

// ───────────── UML class ─────────────

function StringListEditor({
  title,
  items,
  placeholder,
  disabled,
  onChange,
  itemLabel,
}: {
  title: string;
  items: readonly string[];
  placeholder: string;
  disabled: boolean;
  onChange(items: string[], label: string): void;
  itemLabel: string;
}) {
  return (
    <Section
      title={`${title} (${items.length})`}
      action={
        !disabled && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={() => onChange([...items, placeholder], `Add ${itemLabel}`)}
          >
            <Plus className="size-3.5" /> Add
          </Button>
        )
      }
    >
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">None.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="flex items-center gap-1">
              <CommitInput
                value={item}
                onCommit={(v) =>
                  onChange(
                    items.map((x, j) => (j === i ? v : x)),
                    `Edit ${itemLabel}`,
                  )
                }
                normalize={(v) => v.trim() || null}
                aria-label={`${itemLabel} ${i + 1}`}
                disabled={disabled}
                className="font-mono"
              />
              <ReorderButtons
                index={i}
                count={items.length}
                name={`${itemLabel} ${i + 1}`}
                disabled={disabled}
                onMove={(d) => onChange(moveItem(items, i, d), `Reorder ${itemLabel}s`)}
                onRemove={() =>
                  onChange(
                    items.filter((_, j) => j !== i),
                    `Remove ${itemLabel}`,
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function UmlClassEditor({
  el,
  apply,
  disabled,
}: {
  el: UmlClassElement;
  apply: Apply;
  disabled: boolean;
}) {
  return (
    <>
      <Section title="Class">
        <Field label="Name">
          <CommitInput
            value={el.name}
            onCommit={(name) => apply(umlPatch(el, { name }), 'Rename class')}
            normalize={(v) => v.trim() || null}
            disabled={disabled}
          />
        </Field>
        <Field label="Stereotype">
          <CommitInput
            value={el.stereotype ?? ''}
            onCommit={(v) =>
              apply(
                umlPatch(el, { stereotype: v.replace(/^«|»$/g, '').trim() || null }),
                'Change stereotype',
              )
            }
            placeholder="e.g. interface, entity"
            disabled={disabled}
          />
        </Field>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={el.isAbstract}
            disabled={disabled}
            onCheckedChange={(v) =>
              apply(umlPatch(el, { isAbstract: v === true }), 'Toggle abstract')
            }
          />
          Abstract class
        </label>
      </Section>
      <StringListEditor
        title="Attributes"
        itemLabel="attribute"
        items={el.attributes}
        placeholder="+ field: Type"
        disabled={disabled}
        onChange={(attributes, label) => apply(umlPatch(el, { attributes }), label)}
      />
      <StringListEditor
        title="Methods"
        itemLabel="method"
        items={el.methods}
        placeholder="+ method(): void"
        disabled={disabled}
        onChange={(methods, label) => apply(umlPatch(el, { methods }), label)}
      />
    </>
  );
}

// ───────────── sequence ─────────────

function ParticipantSelect({
  el,
  value,
  onChange,
  label,
  disabled,
}: {
  el: SequenceElement;
  value: string;
  onChange(id: string): void;
  label: string;
  disabled: boolean;
}) {
  return (
    <NativeSelect
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      disabled={disabled}
      className="h-7 px-2 pr-7 text-xs"
      wrapperClassName="min-w-0 flex-1"
    >
      {el.participants.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name || '(unnamed)'}
        </option>
      ))}
    </NativeSelect>
  );
}

function SequenceEditor({
  el,
  apply,
  disabled,
}: {
  el: SequenceElement;
  apply: Apply;
  disabled: boolean;
}) {
  const set = (next: SequenceElement, label: string) => apply(sequencePatch(next), label);
  const canAddMessage = el.participants.length > 0;
  return (
    <>
      <Section
        title={`Participants (${el.participants.length})`}
        action={
          !disabled && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              data-testid="sequence-add-participant"
              onClick={() =>
                set(
                  sequenceOps.addParticipant(el, `Participant ${el.participants.length + 1}`),
                  'Add participant',
                )
              }
            >
              <Plus className="size-3.5" /> Add
            </Button>
          )
        }
      >
        <ul className="space-y-1">
          {el.participants.map((p, i) => (
            <li key={p.id} className="flex items-center gap-1" data-testid="sequence-participant">
              <CommitInput
                value={p.name}
                onCommit={(name) =>
                  set(sequenceOps.renameParticipant(el, p.id, name), 'Rename participant')
                }
                normalize={(v) => v.trim() || null}
                aria-label={`Participant ${i + 1} name`}
                disabled={disabled}
              />
              <NativeSelect
                value={p.kind}
                onChange={(e) =>
                  set(
                    sequenceOps.setParticipantKind(
                      el,
                      p.id,
                      e.target.value as SequenceParticipantKind,
                    ),
                    'Change participant kind',
                  )
                }
                aria-label={`Participant ${i + 1} kind`}
                disabled={disabled}
                className="h-7 px-2 pr-7 text-xs"
                wrapperClassName="w-28 shrink-0"
              >
                {PARTICIPANT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </NativeSelect>
              <ReorderButtons
                index={i}
                count={el.participants.length}
                name={p.name}
                disabled={disabled}
                onMove={(d) =>
                  set(sequenceOps.moveParticipant(el, p.id, i + d), 'Reorder participants')
                }
                onRemove={() => set(sequenceOps.removeParticipant(el, p.id), 'Remove participant')}
              />
            </li>
          ))}
        </ul>
      </Section>
      <Section
        title={`Messages (${el.messages.length})`}
        action={
          !disabled &&
          canAddMessage && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              data-testid="sequence-add-message"
              onClick={() => {
                const from = el.participants[0]!.id;
                const to = (el.participants[1] ?? el.participants[0]!).id;
                set(sequenceOps.addMessage(el, from, to, 'message'), 'Add message');
              }}
            >
              <Plus className="size-3.5" /> Add
            </Button>
          )
        }
      >
        {el.messages.length === 0 ? (
          <p className="text-xs text-muted-foreground">No messages yet.</p>
        ) : (
          <ol className="space-y-2">
            {el.messages.map((m, i) => (
              <li
                key={m.id}
                className="space-y-1 rounded-md border p-2"
                data-testid="sequence-message"
              >
                <div className="flex items-center gap-1">
                  <span className="w-4 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <ParticipantSelect
                    el={el}
                    value={m.from}
                    label={`Message ${i + 1} from`}
                    disabled={disabled}
                    onChange={(from) =>
                      set(sequenceOps.updateMessage(el, m.id, { from }), 'Change message')
                    }
                  />
                  <span className="text-xs text-muted-foreground" aria-hidden>
                    →
                  </span>
                  <ParticipantSelect
                    el={el}
                    value={m.to}
                    label={`Message ${i + 1} to`}
                    disabled={disabled}
                    onChange={(to) =>
                      set(sequenceOps.updateMessage(el, m.id, { to }), 'Change message')
                    }
                  />
                </div>
                <div className="flex items-center gap-1">
                  <CommitInput
                    value={m.label}
                    onCommit={(label) =>
                      set(sequenceOps.updateMessage(el, m.id, { label }), 'Edit message')
                    }
                    aria-label={`Message ${i + 1} label`}
                    placeholder="label"
                    disabled={disabled}
                    data-testid="message-label"
                  />
                  <NativeSelect
                    value={m.kind}
                    onChange={(e) =>
                      set(
                        sequenceOps.updateMessage(el, m.id, {
                          kind: e.target.value as SequenceMessageKind,
                        }),
                        'Change message kind',
                      )
                    }
                    aria-label={`Message ${i + 1} kind`}
                    disabled={disabled}
                    className="h-7 px-2 pr-7 text-xs"
                    wrapperClassName="w-28 shrink-0"
                  >
                    {MESSAGE_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </NativeSelect>
                  <ReorderButtons
                    index={i}
                    count={el.messages.length}
                    name={`message ${i + 1}`}
                    disabled={disabled}
                    onMove={(d) =>
                      set(sequenceOps.moveMessage(el, m.id, i + d), 'Reorder messages')
                    }
                    onRemove={() => set(sequenceOps.removeMessage(el, m.id), 'Remove message')}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>
      <Section
        title={`Notes (${el.notes.length})`}
        action={
          !disabled &&
          el.participants.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() =>
                set(sequenceOps.addNote(el, [el.participants[0]!.id], 'Note'), 'Add note')
              }
            >
              <Plus className="size-3.5" /> Add
            </Button>
          )
        }
      >
        {el.notes.length === 0 ? (
          <p className="text-xs text-muted-foreground">No notes.</p>
        ) : (
          <ul className="space-y-2">
            {el.notes.map((n, i) => (
              <li key={n.id} className="space-y-1 rounded-md border p-2">
                <div className="flex items-center gap-1">
                  <CommitInput
                    value={n.text}
                    onCommit={(text) =>
                      set(sequenceOps.updateNote(el, n.id, { text }), 'Edit note')
                    }
                    normalize={(v) => v.trim() || null}
                    aria-label={`Note ${i + 1} text`}
                    disabled={disabled}
                  />
                  <IconButton
                    label={`Remove note ${i + 1}`}
                    disabled={disabled}
                    onClick={() => set(sequenceOps.removeNote(el, n.id), 'Remove note')}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
                <div className="flex items-center gap-1">
                  <ParticipantSelect
                    el={el}
                    value={n.participants[0] ?? el.participants[0]?.id ?? ''}
                    label={`Note ${i + 1} over`}
                    disabled={disabled}
                    onChange={(id) =>
                      set(
                        sequenceOps.updateNote(el, n.id, {
                          participants: [id, ...n.participants.slice(1).filter((p) => p !== id)],
                        }),
                        'Move note',
                      )
                    }
                  />
                  <NativeSelect
                    value={n.participants[1] ?? ''}
                    onChange={(e) =>
                      set(
                        sequenceOps.updateNote(el, n.id, {
                          participants: e.target.value
                            ? [n.participants[0]!, e.target.value]
                            : [n.participants[0]!],
                        }),
                        'Move note',
                      )
                    }
                    aria-label={`Note ${i + 1} spans to`}
                    disabled={disabled}
                    className="h-7 px-2 pr-7 text-xs"
                    wrapperClassName="min-w-0 flex-1"
                  >
                    <option value="">(single)</option>
                    {el.participants
                      .filter((p) => p.id !== n.participants[0])
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </NativeSelect>
                </div>
                <NativeSelect
                  value={String(n.afterMessage)}
                  onChange={(e) =>
                    set(
                      sequenceOps.updateNote(el, n.id, { afterMessage: Number(e.target.value) }),
                      'Move note',
                    )
                  }
                  aria-label={`Note ${i + 1} position`}
                  disabled={disabled}
                  className="h-7 px-2 pr-7 text-xs"
                  wrapperClassName="w-full"
                >
                  <option value="-1">Before the first message</option>
                  {el.messages.map((m, j) => (
                    <option key={m.id} value={String(j)}>
                      After message {j + 1}
                      {m.label ? ` (${m.label})` : ''}
                    </option>
                  ))}
                </NativeSelect>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

const TITLES: Record<StructuredElement['type'], string> = {
  table: 'Table',
  'uml-class': 'UML class',
  sequence: 'Sequence diagram',
};

/** Model editor for tables, UML classes and sequence diagrams; every edit resizes the element to fit. */
export function StructuredEditorPanel() {
  const { editor, canEdit } = useBoardSession();
  const structuredId = useEditorState((s) => s.structuredEditId);
  useEditorState((s) => s.sceneVersion);
  const selected = useSelectedElements();

  const fromState = structuredId ? editor.getElement(structuredId) : undefined;
  const el: StructuredElement | null = isStructuredElement(fromState)
    ? fromState
    : selected.length === 1 && isStructuredElement(selected[0])
      ? selected[0]
      : null;

  React.useEffect(() => () => editor.setState({ structuredEditId: null }), [editor]);

  const id = el?.id ?? null;
  const apply = React.useCallback<Apply>(
    (patch, label) => {
      if (id) editor.updateElements([[id, patch]], label);
    },
    [editor, id],
  );

  if (!el) {
    return (
      <div data-testid="structured-editor" className="flex min-h-0 flex-1 flex-col">
        <EmptyState
          size="sm"
          className="m-3"
          icon={<Table />}
          title="Nothing to edit"
          description="Select a table, UML class or sequence diagram, then press Enter to edit its structure here."
        />
      </div>
    );
  }

  const disabled = !canEdit || el.locked;
  return (
    <div
      data-testid="structured-editor"
      data-element-id={el.id}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex items-center justify-between border-b px-3 py-2 text-xs">
        <Label className="text-xs font-medium">{TITLES[el.type]}</Label>
        {el.locked && <span className="text-muted-foreground">Locked — unlock to edit</span>}
        {!canEdit && <span className="text-muted-foreground">View only</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" key={el.id}>
        {el.type === 'table' && <TableEditor el={el} apply={apply} disabled={disabled} />}
        {el.type === 'uml-class' && <UmlClassEditor el={el} apply={apply} disabled={disabled} />}
        {el.type === 'sequence' && <SequenceEditor el={el} apply={apply} disabled={disabled} />}
      </div>
    </div>
  );
}
