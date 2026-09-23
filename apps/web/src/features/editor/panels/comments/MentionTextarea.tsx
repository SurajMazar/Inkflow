import type { PublicUserDto } from '@inkflow/shared';
import { Spinner, Textarea, UserAvatar, cn } from '@inkflow/ui';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { api } from '@/lib/api';
import { useBoardSession } from '../../hooks/editor-context';
import { findMentionQuery, insertMention, type MentionRef } from './mentions';

const SEARCH_DEBOUNCE_MS = 200;

export interface MentionTextareaProps {
  value: string;
  onChange(value: string): void;
  mentions: readonly MentionRef[];
  onMentionsChange(mentions: MentionRef[]): void;
  onSubmit(): void;
  onCancel?(): void;
  placeholder?: string;
  ariaLabel: string;
  testId?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  rows?: number;
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/**
 * Comment textarea with `@mention` autocomplete. Enter submits, Shift+Enter inserts a newline,
 * Escape cancels. Picking a suggestion inserts `@Name` and records the mention.
 */
export function MentionTextarea({
  value,
  onChange,
  mentions,
  onMentionsChange,
  onSubmit,
  onCancel,
  placeholder,
  ariaLabel,
  testId,
  autoFocus,
  disabled,
  rows = 2,
}: MentionTextareaProps) {
  const { boardId, shareToken } = useBoardSession();
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const listId = React.useId();
  const [caret, setCaret] = React.useState(0);
  const [dismissedAt, setDismissedAt] = React.useState<number | null>(null);
  const [active, setActive] = React.useState(0);

  const mention = React.useMemo(() => findMentionQuery(value, caret), [value, caret]);
  const open = !!mention && mention.query.length > 0 && dismissedAt !== mention.start && !disabled;
  const query = useDebounced(open ? mention.query : '', SEARCH_DEBOUNCE_MS);

  const results = useQuery({
    queryKey: ['users', 'search', boardId, query],
    queryFn: ({ signal }) => api.users.search({ q: query, boardId }, { shareToken, signal }),
    enabled: open && query.length > 0,
    staleTime: 30_000,
  });
  const users: PublicUserDto[] = open ? (results.data ?? []).slice(0, 8) : [];

  React.useEffect(() => setActive(0), [query]);

  React.useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const pick = (user: PublicUserDto) => {
    if (!mention) return;
    const res = insertMention(value, mention.start, caret, {
      id: user.id,
      name: user.name || user.email,
    });
    onChange(res.text);
    onMentionsChange([
      ...mentions.filter((m) => m.id !== res.mention.id || m.name !== res.mention.name),
      res.mention,
    ]);
    setCaret(res.caret);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(res.caret, res.caret);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && users.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => (i + 1) % users.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => (i - 1 + users.length) % users.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(users[Math.min(active, users.length - 1)]!);
        return;
      }
    }
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setDismissedAt(mention.start);
        return;
      }
      if (onCancel) {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit();
    }
  };

  const syncCaret = (el: HTMLTextAreaElement) => setCaret(el.selectionStart ?? el.value.length);

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        rows={rows}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        data-testid={testId}
        role="combobox"
        aria-expanded={open && users.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && users.length > 0 ? `${listId}-${active}` : undefined}
        className="min-h-16 resize-none text-sm"
        onChange={(e) => {
          onChange(e.target.value);
          syncCaret(e.target);
          setDismissedAt(null);
        }}
        onSelect={(e) => syncCaret(e.currentTarget)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <div
          className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
          data-testid="mention-suggestions"
        >
          {results.isFetching && users.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Spinner className="size-3" /> Searching…
            </div>
          ) : users.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {results.isError
                ? 'Could not search people.'
                : query
                  ? 'No matching people'
                  : 'Type a name…'}
            </div>
          ) : (
            <ul
              id={listId}
              role="listbox"
              aria-label="People to mention"
              className="max-h-48 overflow-y-auto py-1"
            >
              {users.map((u, i) => (
                <li
                  key={u.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  data-testid="mention-option"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(u);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm',
                    i === active && 'bg-accent',
                  )}
                >
                  <UserAvatar
                    name={u.name || u.email}
                    src={u.avatarUrl}
                    className="size-5 text-[10px]"
                  />
                  <span className="min-w-0 flex-1 truncate">{u.name || u.email}</span>
                  <span className="truncate text-xs text-muted-foreground">{u.email}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
