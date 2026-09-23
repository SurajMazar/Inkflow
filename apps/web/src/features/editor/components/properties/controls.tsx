import { Label, Slider, ToggleGroup, ToggleGroupItem, Tooltip, TooltipContent, TooltipTrigger, cn } from '@inkflow/ui';
import * as React from 'react';
import { MIXED, type Maybe } from './values';

export function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className={cn('flex flex-col gap-1.5', className)}>
      <h3 id={id} className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

/** Single-choice segmented control (icons with tooltips). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: Maybe<T>;
  options: readonly SegmentOption<T>[];
  onChange(value: T): void;
  testId?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      aria-label={label}
      value={value === MIXED ? '' : value}
      onValueChange={(v) => v && onChange(v as T)}
      className="flex w-full flex-wrap justify-start gap-1"
      data-testid={testId}
    >
      {options.map((o) => (
        <Tooltip key={o.value}>
          <TooltipTrigger asChild>
            <ToggleGroupItem
              value={o.value}
              aria-label={o.label}
              data-testid={testId ? `${testId}-${o.value}` : undefined}
              className="h-8 min-w-8 rounded-md border border-transparent px-1.5 text-xs data-[state=on]:border-primary/40 data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
            >
              {o.icon ?? o.label}
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent side="left">{o.label}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
  testId,
}: {
  label: string;
  value: Maybe<number>;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange(v: number): void;
  testId?: string;
}) {
  const numeric = value === MIXED ? min : value;
  return (
    <div className="flex items-center gap-3">
      <Slider
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={[numeric]}
        onValueChange={(v) => onChange(v[0] ?? numeric)}
        className="flex-1"
        data-testid={testId}
      />
      <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
        {value === MIXED ? '—' : `${Math.round(numeric * 100) / 100}${unit}`}
      </span>
    </div>
  );
}

export function NumberInput({
  label,
  value,
  min,
  max,
  step = 1,
  onCommit,
  className,
}: {
  label: string;
  value: Maybe<number>;
  min: number;
  max: number;
  step?: number;
  onCommit(v: number): void;
  className?: string;
}) {
  const [draft, setDraft] = React.useState(value === MIXED ? '' : String(value));
  React.useEffect(() => setDraft(value === MIXED ? '' : String(Math.round(value * 100) / 100)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (draft !== '' && Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, n)));
    else setDraft(value === MIXED ? '' : String(value));
  };
  const id = React.useId();
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <input
        id={id}
        inputMode="decimal"
        placeholder={value === MIXED ? 'Mixed' : undefined}
        value={draft}
        step={step}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const base = value === MIXED ? min : value;
            onCommit(Math.min(max, Math.max(min, base + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1))));
          }
        }}
        className="h-8 w-full rounded-md border bg-background px-2 text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}
