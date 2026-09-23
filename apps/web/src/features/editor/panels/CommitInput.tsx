import { Input, cn } from '@inkflow/ui';
import * as React from 'react';

export interface CommitInputProps extends Omit<
  React.ComponentProps<'input'>,
  'value' | 'onChange' | 'defaultValue'
> {
  value: string;
  /** Called once per edit (on blur or Enter) when the text changed. */
  onCommit(value: string): void;
  /** Normalizes the committed text (default: trim). Return null to reject and revert. */
  normalize?(value: string): string | null;
}

/**
 * Text input that keeps edits local while typing and commits once on blur or Enter, so every
 * field edit becomes a single history entry. Escape reverts. External changes are picked up
 * while the field is not being edited.
 */
export function CommitInput({
  value,
  onCommit,
  normalize = (v) => v.trim(),
  className,
  onKeyDown,
  onBlur,
  onFocus,
  ...props
}: CommitInputProps) {
  const [draft, setDraft] = React.useState(value);
  const [editing, setEditing] = React.useState(false);
  const cancelled = React.useRef(false);
  React.useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = () => {
    const next = normalize(draft);
    if (next === null) {
      setDraft(value);
      return;
    }
    setDraft(next);
    if (next !== value) onCommit(next);
  };

  return (
    <Input
      {...props}
      value={draft}
      className={cn('h-7 px-2 text-xs', className)}
      onFocus={(e) => {
        setEditing(true);
        onFocus?.(e);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        setEditing(false);
        if (cancelled.current) cancelled.current = false;
        else commit();
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setDraft(value);
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
