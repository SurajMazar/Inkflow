import type { AutoLayoutKind, LayoutDirection } from '@inkflow/diagram-engine';
import { isLinearElement } from '@inkflow/elements';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, ToggleGroup, ToggleGroupItem, cn } from '@inkflow/ui';
import * as React from 'react';
import { useActionEnabled, useBoardSession, useSelectedElements } from '../hooks/editor-context';

const LAYOUTS: { kind: AutoLayoutKind; label: string; description: string; directional: boolean }[] = [
  { kind: 'hierarchical', label: 'Hierarchical', description: 'Layered flow, minimal crossings', directional: true },
  { kind: 'tree', label: 'Tree', description: 'Parent → children, mind maps', directional: true },
  { kind: 'grid', label: 'Grid', description: 'Even rows and columns', directional: false },
  { kind: 'horizontal', label: 'Horizontal', description: 'A single row', directional: false },
  { kind: 'vertical', label: 'Vertical', description: 'A single column', directional: false },
  { kind: 'force', label: 'Force-directed', description: 'Organic, clusters stay close', directional: false },
];

const DIRECTIONS: { value: LayoutDirection; label: string }[] = [
  { value: 'TB', label: 'Top → bottom' },
  { value: 'LR', label: 'Left → right' },
  { value: 'BT', label: 'Bottom → top' },
  { value: 'RL', label: 'Right → left' },
];

/** Small schematic of each layout (nodes as boxes, edges as lines). */
function LayoutIcon({ kind }: { kind: AutoLayoutKind }) {
  const box = (x: number, y: number, key: string) => <rect key={key} x={x - 4} y={y - 3} width={8} height={6} rx={1.5} className="fill-primary/15 stroke-primary" strokeWidth={1} />;
  const line = (x1: number, y1: number, x2: number, y2: number, key: string) => (
    <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-muted-foreground" strokeWidth={1} />
  );
  let content: React.ReactNode;
  switch (kind) {
    case 'hierarchical':
      content = [line(24, 9, 12, 21, 'a'), line(24, 9, 36, 21, 'b'), line(12, 21, 24, 33, 'c'), line(36, 21, 24, 33, 'd'), box(24, 9, '1'), box(12, 21, '2'), box(36, 21, '3'), box(24, 33, '4')];
      break;
    case 'tree':
      content = [line(24, 8, 10, 22, 'a'), line(24, 8, 38, 22, 'b'), line(10, 22, 6, 34, 'c'), line(10, 22, 16, 34, 'd'), line(38, 22, 38, 34, 'e'), box(24, 8, '1'), box(10, 22, '2'), box(38, 22, '3'), box(6, 34, '4'), box(16, 34, '5'), box(38, 34, '6')];
      break;
    case 'grid':
      content = [8, 20, 32].flatMap((y) => [10, 24, 38].map((x) => box(x, y + 1, `${x}-${y}`)));
      break;
    case 'horizontal':
      content = [line(8, 21, 40, 21, 'a'), box(8, 21, '1'), box(19, 21, '2'), box(30, 21, '3'), box(40, 21, '4')];
      break;
    case 'vertical':
      content = [line(24, 6, 24, 36, 'a'), box(24, 6, '1'), box(24, 16, '2'), box(24, 26, '3'), box(24, 36, '4')];
      break;
    case 'force':
      content = [line(14, 12, 26, 20, 'a'), line(26, 20, 38, 10, 'b'), line(26, 20, 22, 33, 'c'), line(22, 33, 36, 32, 'd'), line(14, 12, 8, 26, 'e'), box(14, 12, '1'), box(26, 20, '2'), box(38, 10, '3'), box(22, 33, '4'), box(36, 32, '5'), box(8, 26, '6')];
      break;
  }
  return (
    <svg viewBox="0 0 48 42" className="h-10 w-12" aria-hidden="true">
      {content}
    </svg>
  );
}

/** Chooses and applies an automatic layout to the selected nodes and their connectors. */
export function AutoLayoutDialog({ onClose }: { onClose(): void }) {
  const { editor, canEdit } = useBoardSession();
  const selected = useSelectedElements();
  const [kind, setKind] = React.useState<AutoLayoutKind>('hierarchical');
  const [direction, setDirection] = React.useState<LayoutDirection>('TB');
  const enabled = useActionEnabled('diagram.autoLayout');
  const canSelectConnected = useActionEnabled('diagram.selectConnected');
  const nodes = selected.filter((e) => !isLinearElement(e) && e.type !== 'freedraw' && !e.locked).length;
  const edges = selected.filter(isLinearElement).length;
  const meta = LAYOUTS.find((l) => l.kind === kind)!;

  const apply = () => {
    const ok = editor.actions.run('diagram.autoLayout', meta.directional ? { kind, direction } : { kind });
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg" data-inkflow-ui data-testid="autolayout-dialog">
        <DialogHeader>
          <DialogTitle>Auto layout</DialogTitle>
          <DialogDescription>
            Arranges the selected nodes; connectors between them are re-routed automatically. Elements outside the selection are not moved.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Layout">
          {LAYOUTS.map((l) => (
            <button
              key={l.kind}
              type="button"
              role="radio"
              aria-checked={kind === l.kind}
              data-testid={`autolayout-${l.kind}`}
              onClick={() => setKind(l.kind)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-lg border p-2 text-center outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring',
                kind === l.kind ? 'border-primary bg-primary/5' : 'border-border',
              )}
            >
              <LayoutIcon kind={l.kind} />
              <span className="text-xs font-medium">{l.label}</span>
              <span className="text-[11px] leading-tight text-muted-foreground">{l.description}</span>
            </button>
          ))}
        </div>
        {meta.directional && (
          <div className="grid gap-1.5">
            <span className="text-xs text-muted-foreground" id="autolayout-direction">
              Direction
            </span>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={direction}
              onValueChange={(v) => v && setDirection(v as LayoutDirection)}
              aria-labelledby="autolayout-direction"
              className="w-full"
            >
              {DIRECTIONS.map((d) => (
                <ToggleGroupItem key={d.value} value={d.value} className="flex-1 text-xs" aria-label={d.label}>
                  {d.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        )}
        <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground" role="status">
          {nodes > 1
            ? `${nodes} nodes and ${edges} connectors selected.`
            : 'Select at least two nodes. Tip: select one node and use “Select connected diagram”.'}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" size="sm" disabled={!canSelectConnected} onClick={() => editor.actions.run('diagram.selectConnected')} data-testid="autolayout-select-connected">
            Select connected diagram
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={apply} disabled={!canEdit || !enabled} data-testid="autolayout-apply">
              Apply layout
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
