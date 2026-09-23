import type { SearchMatch } from '@inkflow/canvas-engine';
import { Input, cn } from '@inkflow/ui';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import * as React from 'react';
import { useBoardSession, useEditorState } from '../hooks/editor-context';
import { ELEMENT_ICONS, elementTypeLabel } from './element-labels';

function Snippet({ match }: { match: SearchMatch }) {
  return (
    <span className="line-clamp-2 text-sm break-words">
      {match.text.slice(0, match.start)}
      <mark className="rounded-sm bg-amber-200 px-px text-foreground dark:bg-amber-500/40">{match.text.slice(match.start, match.end)}</mark>
      {match.text.slice(match.end)}
    </span>
  );
}

const FIELD_LABELS: Record<string, string> = {
  text: 'Text',
  name: 'Name',
  label: 'Label',
  column: 'Column',
  attribute: 'Attribute',
  method: 'Method',
  participant: 'Participant',
  message: 'Message',
  note: 'Note',
  link: 'Link',
};

/** Canvas search: highlights matches, Enter / Shift+Enter (or the arrows) step through them. */
export function SearchPanel() {
  const { editor } = useBoardSession();
  const sceneVersion = useEditorState((s) => s.sceneVersion);
  const [query, setQuery] = React.useState('');
  const [current, setCurrent] = React.useState(-1);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const matches = React.useMemo(() => editor.search(query), [editor, query, sceneVersion]);
  const ids = React.useMemo(() => matches.map((m) => m.elementId), [matches]);

  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  React.useEffect(() => {
    editor.setState({ searchHighlightIds: ids });
    setCurrent((c) => (c >= ids.length ? ids.length - 1 : c));
  }, [editor, ids]);

  React.useEffect(() => () => editor.setState({ searchHighlightIds: [] }), [editor]);

  const go = (index: number) => {
    if (ids.length === 0) return;
    const i = ((index % ids.length) + ids.length) % ids.length;
    setCurrent(i);
    editor.focusElement(ids[i]!);
    // Keep every match highlighted; the focused one is also selected.
    editor.setState({ searchHighlightIds: ids });
    listRef.current?.querySelector<HTMLElement>(`[data-index="${i}"]`)?.scrollIntoView?.({ block: 'nearest' });
  };
  const next = () => go(current < 0 ? 0 : current + 1);
  const previous = () => go(current < 0 ? ids.length - 1 : current - 1);

  const status =
    query.trim() === '' ? '' : ids.length === 0 ? 'No results' : current >= 0 ? `${current + 1} of ${ids.length}` : `${ids.length} ${ids.length === 1 ? 'result' : 'results'}`;

  return (
    <div data-testid="panel-search" className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCurrent(-1);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) previous();
                else next();
              }
            }}
            placeholder="Find text, labels, names…"
            aria-label="Search the canvas"
            data-testid="search-canvas-input"
            className="h-8 pr-8 pl-8"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery('');
                setCurrent(-1);
                inputRef.current?.focus();
              }}
              className="absolute top-1/2 right-1.5 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground" role="status" aria-live="polite" data-testid="search-status">
            {status}
          </span>
          <div className="flex gap-0.5">
            <button
              type="button"
              aria-label="Previous match (Shift+Enter)"
              data-testid="search-prev"
              disabled={ids.length === 0}
              onClick={previous}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              <ChevronUp className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Next match (Enter)"
              data-testid="search-next"
              disabled={ids.length === 0}
              onClick={next}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              <ChevronDown className="size-4" />
            </button>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.trim() === '' ? (
          <p className="p-4 text-center text-xs text-muted-foreground">Search text, shape labels, frame names, tables, classes and sequence diagrams.</p>
        ) : matches.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">Nothing on the canvas matches “{query.trim()}”.</p>
        ) : (
          <ul ref={listRef} aria-label="Search results" className="py-1">
            {matches.map((m, i) => {
              const Icon = ELEMENT_ICONS[m.elementType];
              return (
                <li key={`${m.elementId}:${m.field}`}>
                  <button
                    type="button"
                    data-index={i}
                    data-testid="search-result"
                    aria-current={i === current ? 'true' : undefined}
                    onClick={() => go(i)}
                    className={cn(
                      'flex w-full items-start gap-2 px-3 py-2 text-left outline-none hover:bg-accent/50 focus-visible:bg-accent',
                      i === current && 'bg-accent',
                    )}
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <Snippet match={m} />
                      <span className="block text-[11px] text-muted-foreground">
                        {elementTypeLabel(m.elementType)} · {FIELD_LABELS[m.field] ?? (m.field.startsWith('metadata.') ? m.field.slice(9) : m.field)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
