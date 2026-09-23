import type { ToolType } from '@inkflow/canvas-engine';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@inkflow/ui';
import { LayoutGrid, Lock, LockOpen } from 'lucide-react';
import * as React from 'react';
import { useBoardSession, useEditorState } from '../hooks/editor-context';
import { useEditorUi } from '../hooks/ui-store';
import { TOOL_META } from './icons';

type Orientation = 'vertical' | 'horizontal';

const SHAPE_VARIANTS: ToolType[] = ['rectangle', 'roundedRectangle', 'triangle', 'polygon', 'star'];
const DRAW_VARIANTS: ToolType[] = ['pencil', 'brush', 'highlighter'];
const LINE_VARIANTS: ToolType[] = ['arrow', 'line', 'connector'];

function ToolButton({
  tool,
  active,
  onSelect,
  orientation,
  compact,
  showHint = true,
}: {
  tool: ToolType;
  active: boolean;
  onSelect(tool: ToolType): void;
  orientation: Orientation;
  compact?: boolean;
  /** Corner shortcut letter (hidden where a variant caret occupies the corner). */
  showHint?: boolean;
}) {
  const meta = TOOL_META[tool];
  const Icon = meta.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid={`tool-${tool}`}
          aria-label={`${meta.label}${meta.shortcut ? ` (${meta.shortcut})` : ''}`}
          aria-pressed={active}
          onClick={() => onSelect(tool)}
          className={cn(
            'relative flex items-center justify-center rounded-lg text-foreground/80 outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
            compact ? 'size-10' : 'size-9',
            active && 'bg-primary/12 text-primary hover:bg-primary/15 hover:text-primary',
          )}
        >
          <Icon className="size-[18px]" strokeWidth={1.75} />
          {showHint && meta.shortcut?.length === 1 && !compact && (
            <span className="pointer-events-none absolute bottom-[3px] right-[4px] text-[8px] font-medium leading-none text-muted-foreground/80">
              {meta.shortcut}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side={orientation === 'vertical' ? 'right' : 'top'}>
        {meta.label}
        {meta.shortcut && <span className="ml-2 text-muted-foreground">{meta.shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

/** A tool slot that remembers the last-used variant (e.g. rectangle → star) and offers the others. */
function VariantTool({
  variants,
  current,
  onSelect,
  orientation,
  compact,
  label,
}: {
  variants: ToolType[];
  current: ToolType;
  onSelect(tool: ToolType): void;
  orientation: Orientation;
  compact?: boolean;
  label: string;
}) {
  const [last, setLast] = React.useState<ToolType>(variants[0]!);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (variants.includes(current)) setLast(current);
  }, [current, variants]);
  const active = variants.includes(current);
  return (
    <div className="relative flex">
      <ToolButton
        tool={last}
        active={active}
        onSelect={onSelect}
        orientation={orientation}
        compact={compact}
        showHint={false}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`More ${label} tools`}
            className="group/caret absolute bottom-0 right-0 flex size-3.5 items-end justify-end rounded-br-lg p-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg
              viewBox="0 0 6 6"
              aria-hidden="true"
              className="size-[6px] fill-muted-foreground/70 group-hover/caret:fill-foreground"
            >
              <path d="M6 0 V6 H0 Z" />
            </svg>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side={orientation === 'vertical' ? 'right' : 'top'}
          className="flex w-auto gap-1 p-1"
          data-inkflow-ui
        >
          {variants.map((t) => (
            <ToolButton
              key={t}
              tool={t}
              active={current === t}
              orientation={orientation}
              onSelect={(tool) => {
                onSelect(tool);
                setOpen(false);
              }}
            />
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function Divider({ orientation }: { orientation: Orientation }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'bg-border',
        orientation === 'vertical' ? 'mx-1.5 h-px w-auto' : 'my-1.5 h-auto w-px',
      )}
    />
  );
}

/** Floating drawing toolbar. Vertical on desktop, horizontal (scrollable) on phones. */
export function Toolbar({ orientation }: { orientation: Orientation }) {
  const { editor, canEdit } = useBoardSession();
  const tool = useEditorState((s) => s.tool);
  const locked = useEditorState((s) => s.toolLocked);
  const panel = useEditorUi((s) => s.panel);
  const togglePanel = useEditorUi((s) => s.togglePanel);
  const compact = orientation === 'horizontal';
  const select = (t: ToolType) => editor.setTool(t);

  return (
    <nav
      aria-label="Tools"
      data-inkflow-ui
      className={cn(
        'pointer-events-auto flex gap-0.5 rounded-xl border bg-popover/95 p-1 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-popover/80',
        orientation === 'vertical' ? 'flex-col' : 'max-w-full flex-row overflow-x-auto',
      )}
    >
      {canEdit && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Keep selected tool active after drawing (Q)"
              aria-pressed={locked}
              data-testid="tool-lock"
              onClick={() => editor.setState({ toolLocked: !locked })}
              className={cn(
                'flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground',
                compact ? 'size-10' : 'size-9',
                locked && 'text-primary',
              )}
            >
              {locked ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side={orientation === 'vertical' ? 'right' : 'top'}>
            Keep tool active (Q)
          </TooltipContent>
        </Tooltip>
      )}
      <ToolButton
        tool="selection"
        active={tool === 'selection'}
        onSelect={select}
        orientation={orientation}
        compact={compact}
      />
      <ToolButton
        tool="hand"
        active={tool === 'hand'}
        onSelect={select}
        orientation={orientation}
        compact={compact}
      />
      {canEdit ? (
        <>
          <Divider orientation={orientation} />
          <VariantTool
            label="shape"
            variants={SHAPE_VARIANTS}
            current={tool}
            onSelect={select}
            orientation={orientation}
            compact={compact}
          />
          <ToolButton
            tool="diamond"
            active={tool === 'diamond'}
            onSelect={select}
            orientation={orientation}
            compact={compact}
          />
          <ToolButton
            tool="ellipse"
            active={tool === 'ellipse'}
            onSelect={select}
            orientation={orientation}
            compact={compact}
          />
          <VariantTool
            label="line"
            variants={LINE_VARIANTS}
            current={tool}
            onSelect={select}
            orientation={orientation}
            compact={compact}
          />
          <Divider orientation={orientation} />
          <VariantTool
            label="drawing"
            variants={DRAW_VARIANTS}
            current={tool}
            onSelect={select}
            orientation={orientation}
            compact={compact}
          />
          <ToolButton
            tool="eraser"
            active={tool === 'eraser'}
            onSelect={select}
            orientation={orientation}
            compact={compact}
          />
          <ToolButton
            tool="text"
            active={tool === 'text'}
            onSelect={select}
            orientation={orientation}
            compact={compact}
          />
          <ToolButton
            tool="image"
            active={tool === 'image'}
            onSelect={select}
            orientation={orientation}
            compact={compact}
          />
          <Divider orientation={orientation} />
          <ToolButton
            tool="frame"
            active={tool === 'frame'}
            onSelect={select}
            orientation={orientation}
            compact={compact}
          />
          <ToolButton
            tool="node"
            active={tool === 'node'}
            onSelect={select}
            orientation={orientation}
            compact={compact}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Shape library and templates (Shift+L)"
                aria-pressed={panel === 'library'}
                data-testid="open-library"
                onClick={() => togglePanel('library')}
                className={cn(
                  'flex items-center justify-center rounded-lg text-foreground/80 hover:bg-accent hover:text-foreground',
                  compact ? 'size-10' : 'size-9',
                  panel === 'library' && 'bg-primary/12 text-primary',
                )}
              >
                <LayoutGrid className="size-[18px]" strokeWidth={1.75} />
              </button>
            </TooltipTrigger>
            <TooltipContent side={orientation === 'vertical' ? 'right' : 'top'}>
              Library & templates
            </TooltipContent>
          </Tooltip>
        </>
      ) : (
        <Divider orientation={orientation} />
      )}
      <ToolButton
        tool="comment"
        active={tool === 'comment'}
        onSelect={select}
        orientation={orientation}
        compact={compact}
      />
      <ToolButton
        tool="laser"
        active={tool === 'laser'}
        onSelect={select}
        orientation={orientation}
        compact={compact}
      />
    </nav>
  );
}
