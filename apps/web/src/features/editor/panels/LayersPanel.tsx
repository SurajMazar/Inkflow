import type { SceneElement } from '@inkflow/elements';
import { Button, Input, cn } from '@inkflow/ui';
import { Eye, EyeOff, Layers, Lock, LockOpen, Search } from 'lucide-react';
import * as React from 'react';
import { useBoardSession, useEditorState, useSceneElements } from '../hooks/editor-context';
import { ELEMENT_ICONS, elementDisplayName, elementTypeLabel } from './element-labels';

const PAGE_SIZE = 500;

interface Row {
  el: SceneElement;
  name: string;
  depth: number;
}

function LayerRow({ row, selected, canEdit }: { row: Row; selected: boolean; canEdit: boolean }) {
  const { editor } = useBoardSession();
  const { el, name, depth } = row;
  const Icon = ELEMENT_ICONS[el.type];

  const toggleVisibility = () => {
    if (el.hidden) {
      editor.actions.run('arrange.show', { ids: [el.id] });
    } else {
      editor.select([el.id], { expandGroups: false });
      editor.actions.run('arrange.hide');
    }
  };
  const toggleLock = () => {
    if (el.locked) {
      editor.actions.run('arrange.unlock', { ids: [el.id] });
    } else {
      editor.select([el.id], { expandGroups: false });
      editor.actions.run('arrange.lock');
    }
  };

  return (
    <li
      data-testid="layer-row"
      data-element-id={el.id}
      className={cn('group flex h-8 items-center gap-1 pr-1.5 text-sm', selected ? 'bg-primary/10' : 'hover:bg-accent/50', el.hidden && 'text-muted-foreground')}
      style={{ paddingLeft: 8 + Math.min(depth, 6) * 12 }}
    >
      <button
        type="button"
        className="flex h-full min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        aria-pressed={selected}
        aria-label={`${elementTypeLabel(el.type)}: ${name}${el.hidden ? ' (hidden)' : ''}${el.locked ? ' (locked)' : ''}`}
        onClick={(e) => {
          if (el.hidden) return;
          editor.select([el.id], { expandGroups: false, additive: e.shiftKey || e.metaKey || e.ctrlKey });
        }}
        onDoubleClick={() => !el.hidden && editor.focusElement(el.id)}
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className={cn('truncate', el.hidden && 'italic')}>{name}</span>
      </button>
      {canEdit ? (
        <>
          <button
            type="button"
            aria-label={el.hidden ? `Show ${name}` : `Hide ${name}`}
            title={el.locked && !el.hidden ? 'Unlock to hide' : el.hidden ? 'Show' : 'Hide'}
            disabled={el.locked && !el.hidden}
            onClick={toggleVisibility}
            data-testid="layer-visibility"
            className={cn(
              'inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30',
              !el.hidden && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            )}
          >
            {el.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
          <button
            type="button"
            aria-label={el.locked ? `Unlock ${name}` : `Lock ${name}`}
            title={el.locked ? 'Unlock' : 'Lock'}
            onClick={toggleLock}
            data-testid="layer-lock"
            className={cn(
              'inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
              !el.locked && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            )}
          >
            {el.locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
          </button>
        </>
      ) : (
        <span className="flex shrink-0 gap-1 text-muted-foreground" aria-hidden>
          {el.hidden && <EyeOff className="size-3.5" />}
          {el.locked && <Lock className="size-3.5" />}
        </span>
      )}
    </li>
  );
}

/** Every element, top-most first, with selection, visibility and lock toggles. */
export function LayersPanel() {
  const { editor, canEdit } = useBoardSession();
  const elements = useSceneElements();
  const selectedIds = useEditorState((s) => s.selectedIds);
  const [filter, setFilter] = React.useState('');
  const [limit, setLimit] = React.useState(PAGE_SIZE);
  const selected = React.useMemo(() => new Set(selectedIds), [selectedIds]);

  const rows = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    const out: Row[] = [];
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i]!;
      const name = elementDisplayName(el);
      if (q && !name.toLowerCase().includes(q) && !elementTypeLabel(el.type).toLowerCase().includes(q)) continue;
      out.push({ el, name, depth: el.groupIds.length + (el.frameId ? 1 : 0) });
    }
    return out;
  }, [elements, filter]);

  const hiddenCount = React.useMemo(() => elements.filter((e) => e.hidden).length, [elements]);

  return (
    <div data-testid="panel-layers" className="flex min-h-0 flex-1 flex-col">
      <div className="relative border-b p-3">
        <Search className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setLimit(PAGE_SIZE);
          }}
          placeholder="Filter layers"
          aria-label="Filter layers"
          className="h-8 pl-8"
        />
      </div>
      <div className="flex items-center justify-between border-b px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>
          {rows.length} {rows.length === 1 ? 'layer' : 'layers'}
          {hiddenCount ? ` · ${hiddenCount} hidden` : ''}
        </span>
        {canEdit && hiddenCount > 0 && (
          <button type="button" className="text-primary hover:underline" onClick={() => editor.actions.run('arrange.showAll')}>
            Show all
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {elements.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <Layers className="size-5" aria-hidden />
            The board is empty.
          </div>
        ) : rows.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">No layers match “{filter.trim()}”.</p>
        ) : (
          <>
            <ul aria-label="Layers">
              {rows.slice(0, limit).map((row) => (
                <LayerRow key={row.el.id} row={row} selected={selected.has(row.el.id)} canEdit={canEdit} />
              ))}
            </ul>
            {rows.length > limit && (
              <div className="p-2 text-center">
                <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                  Show {Math.min(PAGE_SIZE, rows.length - limit)} more
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
