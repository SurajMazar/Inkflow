import type { Editor, StyleDefaults } from '@inkflow/canvas-engine';
import { iconRegistry, shapeRegistry } from '@inkflow/diagram-engine';
import {
  FONT_FAMILIES,
  FONT_SIZES,
  QUICK_BACKGROUND_COLORS,
  QUICK_STROKE_COLORS,
  type Arrowhead,
  type ElementPatch,
  type SceneElement,
} from '@inkflow/elements';
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@inkflow/ui';
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  BringToFront,
  ChevronDown,
  Copy,
  Crop,
  FlipHorizontal2,
  FlipVertical2,
  Group,
  ImageUp,
  Italic,
  Link2,
  Lock,
  Network,
  Plus,
  SendToBack,
  Trash2,
  Underline,
  Ungroup,
  X,
} from 'lucide-react';
import * as React from 'react';
import { pickImageFiles, uploadBoardImage } from '../../collab/editor-host';
import { useBoardSession } from '../../hooks/editor-context';
import { ColorPicker } from '../ColorPicker';
import { NumberInput, Section, Segmented, SliderRow } from './controls';
import { MIXED, commonValue, type Capabilities, type Maybe } from './values';

export interface SectionProps {
  editor: Editor;
  elements: readonly SceneElement[];
  style: StyleDefaults;
  caps: Capabilities;
}

/** Applies a change to the defaults and to the selection. */
function useApply(editor: Editor) {
  return React.useCallback(
    (defaults: Partial<StyleDefaults>, patch?: ElementPatch) =>
      editor.applyStyle(defaults, patch ?? (defaults as ElementPatch)),
    [editor],
  );
}

function value<T>(elements: readonly SceneElement[], key: string, fallback: T): Maybe<T> {
  return elements.length ? commonValue(elements, key, fallback) : fallback;
}

const asColor = (v: Maybe<string>) => (v === MIXED ? '#1e1e1e' : v);

// ───────────────────────────── stroke & fill ─────────────────────────────

const StrokeWidthIcon = ({ w }: { w: number }) => (
  <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true">
    <line
      x1="3"
      y1="10"
      x2="17"
      y2="10"
      stroke="currentColor"
      strokeWidth={w}
      strokeLinecap="round"
    />
  </svg>
);
const DashIcon = ({ dash }: { dash: string }) => (
  <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true">
    <line
      x1="2"
      y1="10"
      x2="18"
      y2="10"
      stroke="currentColor"
      strokeWidth={2}
      strokeDasharray={dash}
      strokeLinecap="round"
    />
  </svg>
);
const RoughIcon = ({ level }: { level: 0 | 1 | 2 }) => (
  <svg
    viewBox="0 0 20 20"
    className="size-5"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
  >
    {level === 0 && <path d="M3 14 C7 6, 13 6, 17 14" />}
    {level === 1 && <path d="M3 14 C6 7, 9 5, 11 8 S15 10, 17 14" />}
    {level === 2 && <path d="M3 14 C5 5, 8 11, 10 6 S14 12, 15 7 L17 14" />}
  </svg>
);
const FillIcon = ({ kind }: { kind: 'hachure' | 'cross-hatch' | 'zigzag' | 'solid' }) => (
  <svg
    viewBox="0 0 20 20"
    className="size-5"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.2"
  >
    <rect
      x="3"
      y="3"
      width="14"
      height="14"
      rx="2"
      fill={kind === 'solid' ? 'currentColor' : 'none'}
    />
    {kind === 'hachure' && <path d="M3 13 L13 3 M3 17 L17 3 M7 17 L17 7" />}
    {kind === 'cross-hatch' && (
      <path d="M3 13 L13 3 M3 17 L17 3 M7 17 L17 7 M7 3 L17 13 M3 3 L17 17 M3 7 L13 17" />
    )}
    {kind === 'zigzag' && <path d="M4 14 L7 6 L10 14 L13 6 L16 14" />}
  </svg>
);

export function StyleSection({ editor, elements, style, caps }: SectionProps) {
  const apply = useApply(editor);
  const background = value(elements, 'backgroundColor', style.backgroundColor);
  return (
    <>
      {caps.stroke && (
        <Section title="Stroke">
          <ColorPicker
            label="Stroke color"
            value={asColor(value(elements, 'strokeColor', style.strokeColor))}
            quick={QUICK_STROKE_COLORS}
            onChange={(c) => apply({ strokeColor: c })}
            testId="stroke-color"
          />
        </Section>
      )}
      {caps.background && (
        <Section title="Background">
          <ColorPicker
            label="Background color"
            value={background === MIXED ? 'transparent' : background}
            quick={QUICK_BACKGROUND_COLORS}
            allowTransparent
            onChange={(c) => apply({ backgroundColor: c })}
            testId="background-color"
          />
        </Section>
      )}
      {caps.fill && background !== 'transparent' && (
        <Section title="Fill">
          <Segmented
            label="Fill style"
            value={value(elements, 'fillStyle', style.fillStyle)}
            onChange={(v) => apply({ fillStyle: v })}
            testId="fill-style"
            options={[
              { value: 'hachure', label: 'Hachure', icon: <FillIcon kind="hachure" /> },
              { value: 'cross-hatch', label: 'Cross-hatch', icon: <FillIcon kind="cross-hatch" /> },
              { value: 'zigzag', label: 'Zigzag', icon: <FillIcon kind="zigzag" /> },
              { value: 'solid', label: 'Solid', icon: <FillIcon kind="solid" /> },
            ]}
          />
        </Section>
      )}
      {caps.strokeWidth && (
        <Section title="Stroke width">
          <Segmented
            label="Stroke width"
            value={stringify(value(elements, 'strokeWidth', style.strokeWidth))}
            onChange={(v) => apply({ strokeWidth: Number(v) })}
            testId="stroke-width"
            options={[
              { value: '1', label: 'Thin', icon: <StrokeWidthIcon w={1} /> },
              { value: '2', label: 'Bold', icon: <StrokeWidthIcon w={2.2} /> },
              { value: '4', label: 'Extra bold', icon: <StrokeWidthIcon w={4} /> },
              { value: '8', label: 'Heavy', icon: <StrokeWidthIcon w={6} /> },
            ]}
          />
        </Section>
      )}
      {caps.strokeStyle && (
        <Section title="Stroke style">
          <Segmented
            label="Stroke style"
            value={value(elements, 'strokeStyle', style.strokeStyle)}
            onChange={(v) => apply({ strokeStyle: v })}
            testId="stroke-style"
            options={[
              { value: 'solid', label: 'Solid', icon: <DashIcon dash="0" /> },
              { value: 'dashed', label: 'Dashed', icon: <DashIcon dash="5 3" /> },
              { value: 'dotted', label: 'Dotted', icon: <DashIcon dash="0.1 3.5" /> },
            ]}
          />
        </Section>
      )}
      {caps.roughness && (
        <Section title="Sloppiness">
          <Segmented
            label="Sloppiness"
            value={stringify(value(elements, 'roughness', style.roughness))}
            onChange={(v) => apply({ roughness: Number(v) })}
            testId="roughness"
            options={[
              { value: '0', label: 'Architect', icon: <RoughIcon level={0} /> },
              { value: '1', label: 'Artist', icon: <RoughIcon level={1} /> },
              { value: '2', label: 'Cartoonist', icon: <RoughIcon level={2} /> },
            ]}
          />
        </Section>
      )}
      {caps.roundness && (
        <Section title="Edges">
          <Segmented
            label="Edges"
            value={value(elements, 'roundness', style.roundness)}
            onChange={(v) => apply({ roundness: v })}
            testId="roundness"
            options={[
              {
                value: 'sharp',
                label: 'Sharp',
                icon: (
                  <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true">
                    <path d="M4 16 V4 H16" fill="none" stroke="currentColor" strokeWidth="1.8" />
                  </svg>
                ),
              },
              {
                value: 'round',
                label: 'Round',
                icon: (
                  <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true">
                    <path
                      d="M4 16 V10 A6 6 0 0 1 10 4 H16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    />
                  </svg>
                ),
              },
            ]}
          />
        </Section>
      )}
    </>
  );
}

function stringify(v: Maybe<number>): Maybe<string> {
  return v === MIXED ? MIXED : String(v);
}

// ───────────────────────────── text ─────────────────────────────

export function TextSection({ editor, elements, style, caps }: SectionProps) {
  const apply = useApply(editor);
  const fontSize = value(elements, 'fontSize', style.fontSize);
  const bold = value(elements, 'fontWeight', style.fontWeight) === 'bold';
  const italic = value(elements, 'fontStyle', style.fontStyle) === 'italic';
  const underline = value(elements, 'textDecoration', style.textDecoration) === 'underline';
  const hasLabels = elements.some(
    (e) => 'label' in e && e.type !== 'arrow' && e.type !== 'line' && e.type !== 'connector',
  );
  return (
    <Section title="Text">
      <Select
        value={(() => {
          const f = value(elements, 'fontFamily', style.fontFamily);
          return f === MIXED ? undefined : f;
        })()}
        onValueChange={(v) => apply({ fontFamily: v as StyleDefaults['fontFamily'] })}
      >
        <SelectTrigger className="h-8 text-xs" aria-label="Font family" data-testid="font-family">
          <SelectValue placeholder="Mixed fonts" />
        </SelectTrigger>
        <SelectContent data-inkflow-ui>
          {(Object.keys(FONT_FAMILIES) as (keyof typeof FONT_FAMILIES)[]).map((f) => (
            <SelectItem key={f} value={f} style={{ fontFamily: FONT_FAMILIES[f].css }}>
              {FONT_FAMILIES[f].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-1.5">
        <Segmented
          label="Font size"
          value={
            fontSize === MIXED
              ? MIXED
              : (Object.entries(FONT_SIZES).find(([, v]) => v === fontSize)?.[0] ?? MIXED)
          }
          onChange={(k) => apply({ fontSize: FONT_SIZES[k as keyof typeof FONT_SIZES] })}
          testId="font-size"
          options={(Object.keys(FONT_SIZES) as (keyof typeof FONT_SIZES)[]).map((k) => ({
            value: k,
            label: k,
          }))}
        />
        <NumberInput
          className="w-16 shrink-0"
          label="Font size in pixels"
          value={fontSize}
          min={4}
          max={400}
          onCommit={(n) => apply({ fontSize: n })}
        />
      </div>
      {caps.textFull && (
        <>
          <div className="flex items-center gap-1">
            {[
              { on: bold, icon: <Bold className="size-4" />, label: 'Bold', action: 'text.bold' },
              {
                on: italic,
                icon: <Italic className="size-4" />,
                label: 'Italic',
                action: 'text.italic',
              },
              {
                on: underline,
                icon: <Underline className="size-4" />,
                label: 'Underline',
                action: 'text.underline',
              },
            ].map((b) => (
              <Button
                key={b.label}
                variant="ghost"
                size="icon"
                aria-label={b.label}
                aria-pressed={b.on}
                className={cn('size-8', b.on && 'bg-primary/10 text-primary')}
                onClick={() => editor.actions.run(b.action)}
              >
                {b.icon}
              </Button>
            ))}
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            <Segmented
              label="Text align"
              value={value(elements, 'textAlign', style.textAlign)}
              onChange={(v) => apply({ textAlign: v })}
              options={[
                { value: 'left', label: 'Left', icon: <AlignLeft className="size-4" /> },
                { value: 'center', label: 'Center', icon: <AlignCenter className="size-4" /> },
                { value: 'right', label: 'Right', icon: <AlignRight className="size-4" /> },
              ]}
            />
          </div>
          {hasLabels && (
            <Segmented
              label="Vertical align"
              value={value(elements, 'verticalAlign', style.verticalAlign)}
              onChange={(v) => apply({ verticalAlign: v })}
              options={[
                { value: 'top', label: 'Top', icon: <AlignStartHorizontal className="size-4" /> },
                {
                  value: 'middle',
                  label: 'Middle',
                  icon: <AlignCenterHorizontal className="size-4" />,
                },
                {
                  value: 'bottom',
                  label: 'Bottom',
                  icon: <AlignEndHorizontal className="size-4" />,
                },
              ]}
            />
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              Line height
              <NumberInput
                label="Line height"
                value={value(elements, 'lineHeight', style.lineHeight)}
                min={0.5}
                max={5}
                step={0.05}
                onCommit={(n) => apply({ lineHeight: n })}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              Letter spacing
              <NumberInput
                label="Letter spacing"
                value={value(elements, 'letterSpacing', style.letterSpacing)}
                min={-20}
                max={100}
                step={0.5}
                onCommit={(n) => apply({ letterSpacing: n })}
              />
            </label>
          </div>
        </>
      )}
    </Section>
  );
}

// ───────────────────────────── arrows & connectors ─────────────────────────────

const ARROWHEAD_OPTIONS: { value: Arrowhead; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'arrow', label: 'Arrow' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'triangle-outline', label: 'Triangle (outline)' },
  { value: 'dot', label: 'Dot' },
  { value: 'circle-outline', label: 'Circle' },
  { value: 'bar', label: 'Bar' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'diamond-outline', label: 'Diamond (outline)' },
  { value: 'er-one', label: 'ER: one' },
  { value: 'er-one-only', label: 'ER: exactly one' },
  { value: 'er-zero-one', label: 'ER: zero or one' },
  { value: 'er-many', label: 'ER: many' },
  { value: 'er-one-many', label: 'ER: one or many' },
  { value: 'er-zero-many', label: 'ER: zero or many' },
];

function ArrowheadSelect({
  label,
  value: v,
  onChange,
  testId,
}: {
  label: string;
  value: Maybe<Arrowhead>;
  onChange(a: Arrowhead): void;
  testId: string;
}) {
  return (
    <Select value={v === MIXED ? undefined : v} onValueChange={(x) => onChange(x as Arrowhead)}>
      <SelectTrigger className="h-8 text-xs" aria-label={label} data-testid={testId}>
        <SelectValue placeholder="Mixed" />
      </SelectTrigger>
      <SelectContent data-inkflow-ui>
        {ARROWHEAD_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ArrowSection({ editor, elements, style, caps }: SectionProps) {
  const apply = useApply(editor);
  const connectorOnly = elements.length > 0 && elements.every((e) => e.type === 'connector');
  return (
    <>
      {caps.arrowheads && (
        <Section title="Arrowheads">
          <div className="grid grid-cols-2 gap-2">
            <ArrowheadSelect
              label="Start arrowhead"
              testId="arrowhead-start"
              value={value(elements, 'startArrowhead', style.startArrowhead)}
              onChange={(a) => apply({ startArrowhead: a })}
            />
            <ArrowheadSelect
              label="End arrowhead"
              testId="arrowhead-end"
              value={value(elements, 'endArrowhead', style.endArrowhead)}
              onChange={(a) => apply({ endArrowhead: a })}
            />
          </div>
        </Section>
      )}
      {caps.pathStyle && !connectorOnly && (
        <Section title="Path">
          <Segmented
            label="Path style"
            value={value(elements, 'pathStyle', style.arrowPathStyle)}
            onChange={(v) => apply({ arrowPathStyle: v }, { pathStyle: v })}
            testId="path-style"
            options={[
              { value: 'sharp', label: 'Straight' },
              { value: 'curved', label: 'Curved' },
              { value: 'elbow', label: 'Elbow' },
            ]}
          />
        </Section>
      )}
      {caps.routing && (
        <Section title="Routing">
          <Select
            value={(() => {
              const r = value(elements, 'routing', style.connectorRouting);
              return r === MIXED ? undefined : r;
            })()}
            onValueChange={(v) => {
              const routing = v as StyleDefaults['connectorRouting'];
              apply({ connectorRouting: routing }, { routing });
            }}
          >
            <SelectTrigger
              className="h-8 text-xs"
              aria-label="Connector routing"
              data-testid="connector-routing"
            >
              <SelectValue placeholder="Mixed" />
            </SelectTrigger>
            <SelectContent data-inkflow-ui>
              <SelectItem value="orthogonal">Orthogonal (avoids shapes)</SelectItem>
              <SelectItem value="elbow">Elbow</SelectItem>
              <SelectItem value="straight">Straight</SelectItem>
              <SelectItem value="curved">Curved</SelectItem>
              <SelectItem value="bezier">Bézier</SelectItem>
            </SelectContent>
          </Select>
          {elements.length > 0 && (
            <Select
              value={(() => {
                const k = value(elements, 'edgeKind', 'flow');
                return k === MIXED ? undefined : k;
              })()}
              onValueChange={(v) =>
                editor.applyStyle({}, { edgeKind: v as never, ...edgeKindStyle(v) })
              }
            >
              <SelectTrigger className="h-8 text-xs" aria-label="Relationship type">
                <SelectValue placeholder="Mixed" />
              </SelectTrigger>
              <SelectContent data-inkflow-ui>
                {[
                  'flow',
                  'association',
                  'dependency',
                  'inheritance',
                  'realization',
                  'aggregation',
                  'composition',
                  'relationship',
                  'message',
                  'transition',
                ].map((k) => (
                  <SelectItem key={k} value={k} className="capitalize">
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Section>
      )}
    </>
  );
}

/** UML conventions applied when the relationship type changes. */
function edgeKindStyle(kind: string): ElementPatch {
  switch (kind) {
    case 'inheritance':
      return { endArrowhead: 'triangle-outline', startArrowhead: 'none', strokeStyle: 'solid' };
    case 'realization':
      return { endArrowhead: 'triangle-outline', startArrowhead: 'none', strokeStyle: 'dashed' };
    case 'dependency':
      return { endArrowhead: 'arrow', startArrowhead: 'none', strokeStyle: 'dashed' };
    case 'aggregation':
      return { startArrowhead: 'diamond-outline', endArrowhead: 'none', strokeStyle: 'solid' };
    case 'composition':
      return { startArrowhead: 'diamond', endArrowhead: 'none', strokeStyle: 'solid' };
    case 'association':
      return { startArrowhead: 'none', endArrowhead: 'arrow', strokeStyle: 'solid' };
    case 'relationship':
      return { startArrowhead: 'er-one-only', endArrowhead: 'er-zero-many', strokeStyle: 'solid' };
    default:
      return {};
  }
}

// ───────────────────────────── element specific ─────────────────────────────

function IconPicker({
  value: current,
  onChange,
}: {
  value: string | null;
  onChange(icon: string | null): void;
}) {
  const [q, setQ] = React.useState('');
  const icons = iconRegistry
    .list()
    .filter(
      (i) =>
        !q ||
        i.label.toLowerCase().includes(q.toLowerCase()) ||
        i.keywords.some((k) => k.includes(q.toLowerCase())),
    );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 justify-between text-xs"
          data-testid="node-icon"
        >
          {current ? (iconRegistry.get(current)?.label ?? current) : 'No icon'}
          <ChevronDown className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" side="left" data-inkflow-ui>
        <Input
          autoFocus
          placeholder="Search icons"
          className="mb-2 h-8 text-xs"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="grid max-h-60 grid-cols-7 gap-1 overflow-y-auto">
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded hover:bg-accent"
            aria-label="No icon"
            onClick={() => onChange(null)}
          >
            <X className="size-4" />
          </button>
          {icons.map((icon) => (
            <button
              key={icon.key}
              type="button"
              aria-label={icon.label}
              title={icon.label}
              className={cn(
                'flex size-8 items-center justify-center rounded hover:bg-accent',
                current === icon.key && 'bg-primary/10 text-primary',
              )}
              onClick={() => onChange(icon.key)}
            >
              <svg
                viewBox="0 0 24 24"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {icon.paths.map((d, i) => (
                  <path key={i} d={d} />
                ))}
                {icon.fills?.map((d, i) => (
                  <path key={`f${i}`} d={d} fill="currentColor" stroke="none" />
                ))}
              </svg>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MetadataEditor({
  editor,
  element,
}: {
  editor: Editor;
  element: Extract<SceneElement, { type: 'node' }>;
}) {
  const entries = Object.entries(element.metadata);
  const [key, setKey] = React.useState('');
  const [val, setVal] = React.useState('');
  const update = (metadata: Record<string, string>) =>
    editor.updateElements([[element.id, { metadata }]], 'Edit metadata');
  return (
    <div className="flex flex-col gap-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-1 text-xs">
          <span className="w-20 truncate font-medium" title={k}>
            {k}
          </span>
          <Input
            aria-label={`${k} value`}
            className="h-7 flex-1 text-xs"
            defaultValue={v}
            onBlur={(e) =>
              e.target.value !== v && update({ ...element.metadata, [k]: e.target.value })
            }
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={`Remove ${k}`}
            onClick={() => {
              const next = { ...element.metadata };
              delete next[k];
              update(next);
            }}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!key.trim()) return;
          update({ ...element.metadata, [key.trim()]: val });
          setKey('');
          setVal('');
        }}
      >
        <Input
          aria-label="Metadata key"
          placeholder="Key"
          className="h-7 w-20 text-xs"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <Input
          aria-label="Metadata value"
          placeholder="Value"
          className="h-7 flex-1 text-xs"
          value={val}
          onChange={(e) => setVal(e.target.value)}
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Add metadata"
        >
          <Plus className="size-3.5" />
        </Button>
      </form>
    </div>
  );
}

export function ElementSpecificSection({ editor, elements, style }: SectionProps) {
  const { boardId, shareToken } = useBoardSession();
  const single = elements.length === 1 ? elements[0]! : null;
  const apply = useApply(editor);
  const allNodes = elements.length > 0 && elements.every((e) => e.type === 'node');
  const nodes = elements.filter(
    (e): e is Extract<SceneElement, { type: 'node' }> => e.type === 'node',
  );
  return (
    <>
      {(allNodes || (elements.length === 0 && editor.state.tool === 'node')) && (
        <Section title="Node">
          <Select
            value={(() => {
              const s = elements.length
                ? commonValue(nodes, 'shape', style.nodeShape)
                : style.nodeShape;
              return s === MIXED ? undefined : s;
            })()}
            onValueChange={(shape) => {
              const def = shapeRegistry.get(shape);
              apply(
                { nodeShape: shape },
                {
                  shape,
                  ...(def?.defaultIcon !== undefined && nodes.every((n) => !n.icon)
                    ? { icon: def.defaultIcon }
                    : {}),
                },
              );
            }}
          >
            <SelectTrigger className="h-8 text-xs" aria-label="Node shape" data-testid="node-shape">
              <SelectValue placeholder="Mixed shapes" />
            </SelectTrigger>
            <SelectContent className="max-h-72" data-inkflow-ui>
              {shapeRegistry.list().map((s) => (
                <SelectItem key={s.key} value={s.key}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {single?.type === 'node' && (
            <>
              <IconPicker
                value={single.icon}
                onChange={(icon) => editor.updateElements([[single.id, { icon }]], 'Change icon')}
              />
              <p className="mt-1 text-[11px] font-medium text-muted-foreground">Metadata</p>
              <MetadataEditor editor={editor} element={single} />
            </>
          )}
        </Section>
      )}
      {single?.type === 'polygon' && (
        <Section title="Sides">
          <SliderRow
            label="Polygon sides"
            value={single.sides}
            min={3}
            max={12}
            onChange={(n) => apply({ polygonSides: n }, { sides: n })}
          />
        </Section>
      )}
      {single?.type === 'star' && (
        <Section title="Star">
          <SliderRow
            label="Star points"
            value={single.spikes}
            min={3}
            max={16}
            onChange={(n) => apply({ starSpikes: n }, { spikes: n })}
          />
          <SliderRow
            label="Inner radius"
            value={single.innerRatio}
            min={0.1}
            max={0.9}
            step={0.05}
            onChange={(n) => editor.applyStyle({}, { innerRatio: n })}
          />
        </Section>
      )}
      {single?.type === 'frame' && (
        <Section title="Frame">
          <Input
            aria-label="Frame name"
            className="h-8 text-xs"
            defaultValue={single.name}
            key={single.id + single.name}
            onBlur={(e) =>
              e.target.value !== single.name &&
              editor.updateElements([[single.id, { name: e.target.value }]], 'Rename frame')
            }
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <label className="flex items-center justify-between text-xs">
            Clip content
            <Switch
              checked={single.clip}
              onCheckedChange={(clip) =>
                editor.updateElements([[single.id, { clip }]], 'Frame clipping')
              }
            />
          </label>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => editor.startPresentation(single.id)}
          >
            Present from this frame
          </Button>
        </Section>
      )}
      {single?.type === 'image' && (
        <Section title="Image">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={() => editor.setState({ cropId: single.id })}
              data-testid="image-crop"
            >
              <Crop className="size-3.5" /> Crop
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={async () => {
                const [file] = await pickImageFiles();
                if (!file) return;
                const fileId = crypto.randomUUID();
                const url = URL.createObjectURL(file);
                const img = new Image();
                img.onload = () => {
                  editor.images.set(fileId, img);
                  const ratio = img.naturalHeight / Math.max(1, img.naturalWidth);
                  editor.updateElements(
                    [
                      [
                        single.id,
                        {
                          fileId,
                          naturalWidth: img.naturalWidth,
                          naturalHeight: img.naturalHeight,
                          crop: null,
                          height: single.width * ratio,
                          status: 'pending',
                        },
                      ],
                    ],
                    'Replace image',
                  );
                  void uploadBoardImage(boardId, shareToken, file, fileId, file.name).then(
                    (meta) => {
                      editor.registerFile(meta);
                      editor.mutate(
                        'Image uploaded',
                        (tx) => tx.update(single.id, { status: 'saved' }),
                        { history: false },
                      );
                    },
                  );
                };
                img.src = url;
              }}
            >
              <ImageUp className="size-3.5" /> Replace
            </Button>
          </div>
          {single.crop && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() =>
                editor.updateElements(
                  [
                    [
                      single.id,
                      {
                        crop: null,
                        height:
                          single.width * (single.naturalHeight / Math.max(1, single.naturalWidth)),
                      },
                    ],
                  ],
                  'Reset crop',
                )
              }
            >
              Reset crop
            </Button>
          )}
          <label className="flex items-center justify-between text-xs">
            Lock aspect ratio
            <Switch
              checked={single.lockAspectRatio}
              onCheckedChange={(lockAspectRatio) =>
                editor.updateElements([[single.id, { lockAspectRatio }]], 'Aspect ratio')
              }
            />
          </label>
        </Section>
      )}
    </>
  );
}

// ───────────────────────────── opacity & arrange ─────────────────────────────

export function OpacitySection({ editor, elements, style }: SectionProps) {
  return (
    <Section title="Opacity">
      <SliderRow
        label="Opacity"
        value={value(elements, 'opacity', style.opacity)}
        min={0}
        max={100}
        step={5}
        unit="%"
        testId="opacity"
        onChange={(n) => editor.applyStyle({ opacity: n })}
      />
    </Section>
  );
}

function IconAction({
  label,
  icon,
  action,
  editor,
  payload,
}: {
  label: string;
  icon: React.ReactNode;
  action: string;
  editor: Editor;
  payload?: unknown;
}) {
  const enabled = editor.actions.isEnabled(action);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={label}
          disabled={!enabled}
          onClick={() => editor.actions.run(action, payload)}
          data-testid={`action-${action}`}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

export function ArrangeSection({ editor, elements }: SectionProps) {
  if (elements.length === 0) return null;
  const multi = elements.length > 1;
  return (
    <>
      <Section title="Layers">
        <div className="flex flex-wrap gap-0.5">
          <IconAction
            editor={editor}
            action="arrange.sendToBack"
            label="Send to back"
            icon={<SendToBack className="size-4" />}
          />
          <IconAction
            editor={editor}
            action="arrange.sendBackward"
            label="Send backward"
            icon={<ArrowDownToLine className="size-4" />}
          />
          <IconAction
            editor={editor}
            action="arrange.bringForward"
            label="Bring forward"
            icon={<ArrowUpToLine className="size-4" />}
          />
          <IconAction
            editor={editor}
            action="arrange.bringToFront"
            label="Bring to front"
            icon={<BringToFront className="size-4" />}
          />
          <IconAction
            editor={editor}
            action="arrange.flipHorizontal"
            label="Flip horizontal"
            icon={<FlipHorizontal2 className="size-4" />}
          />
          <IconAction
            editor={editor}
            action="arrange.flipVertical"
            label="Flip vertical"
            icon={<FlipVertical2 className="size-4" />}
          />
        </div>
      </Section>
      {multi && (
        <Section title="Align">
          <div className="flex flex-wrap gap-0.5">
            <IconAction
              editor={editor}
              action="arrange.alignLeft"
              label="Align left"
              icon={<AlignStartVertical className="size-4" />}
            />
            <IconAction
              editor={editor}
              action="arrange.alignCenter"
              label="Align center"
              icon={<AlignCenterVertical className="size-4" />}
            />
            <IconAction
              editor={editor}
              action="arrange.alignRight"
              label="Align right"
              icon={<AlignEndVertical className="size-4" />}
            />
            <IconAction
              editor={editor}
              action="arrange.alignTop"
              label="Align top"
              icon={<AlignStartHorizontal className="size-4" />}
            />
            <IconAction
              editor={editor}
              action="arrange.alignMiddle"
              label="Align middle"
              icon={<AlignCenterHorizontal className="size-4" />}
            />
            <IconAction
              editor={editor}
              action="arrange.alignBottom"
              label="Align bottom"
              icon={<AlignEndHorizontal className="size-4" />}
            />
            <IconAction
              editor={editor}
              action="arrange.distributeHorizontal"
              label="Distribute horizontally"
              icon={<AlignHorizontalDistributeCenter className="size-4" />}
            />
            <IconAction
              editor={editor}
              action="arrange.distributeVertical"
              label="Distribute vertically"
              icon={<AlignVerticalDistributeCenter className="size-4" />}
            />
          </div>
        </Section>
      )}
      <Section title="Actions">
        <div className="flex flex-wrap gap-0.5">
          <IconAction
            editor={editor}
            action="edit.duplicate"
            label="Duplicate (⌘D)"
            icon={<Copy className="size-4" />}
          />
          <IconAction
            editor={editor}
            action="edit.delete"
            label="Delete"
            icon={<Trash2 className="size-4" />}
          />
          {multi && (
            <IconAction
              editor={editor}
              action="arrange.group"
              label="Group (⌘G)"
              icon={<Group className="size-4" />}
            />
          )}
          {elements.some((e) => e.groupIds.length) && (
            <IconAction
              editor={editor}
              action="arrange.ungroup"
              label="Ungroup (⇧⌘G)"
              icon={<Ungroup className="size-4" />}
            />
          )}
          <IconAction
            editor={editor}
            action="arrange.lock"
            label="Lock"
            icon={<Lock className="size-4" />}
          />
          {elements.length === 1 && (
            <IconAction
              editor={editor}
              action="element.link"
              label="Add link"
              icon={<Link2 className="size-4" />}
            />
          )}
          {elements.filter((e) => e.type !== 'arrow' && e.type !== 'line' && e.type !== 'connector')
            .length > 1 && (
            <IconAction
              editor={editor}
              action="diagram.autoLayout"
              label="Auto layout"
              icon={<Network className="size-4" />}
            />
          )}
        </div>
      </Section>
    </>
  );
}
