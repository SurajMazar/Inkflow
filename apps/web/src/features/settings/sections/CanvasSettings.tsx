import * as React from 'react';
import { Slider, ToggleGroup, ToggleGroupItem } from '@inkflow/ui';
import type { UserPreferences } from '@inkflow/shared';
import { SettingRow, SettingsSection, SwitchRow, useSavePreferences } from '../components';

type GridType = UserPreferences['grid']['type'];

export function CanvasSettings() {
  const { preferences, save } = useSavePreferences();
  const { grid, snapping, canvas } = preferences;
  const [gridSize, setGridSize] = React.useState(grid.size);
  React.useEffect(() => setGridSize(grid.size), [grid.size]);

  return (
    <div className="grid gap-8">
      <SettingsSection title="Grid" description="Defaults for new boards and your view of existing ones.">
        <SwitchRow
          label="Show grid"
          checked={grid.enabled}
          onCheckedChange={(enabled) => void save({ grid: { enabled } })}
          testId="canvas-grid-enabled"
        />
        <SettingRow label="Grid style">
          {(props) => (
            <ToggleGroup
              {...props}
              type="single"
              variant="outline"
              size="sm"
              value={grid.type}
              onValueChange={(value) => value && void save({ grid: { type: value as GridType } })}
              aria-label="Grid style"
            >
              <ToggleGroupItem value="dot" className="px-3">
                Dots
              </ToggleGroupItem>
              <ToggleGroupItem value="square" className="px-3">
                Lines
              </ToggleGroupItem>
              <ToggleGroupItem value="isometric" className="px-3">
                Isometric
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        </SettingRow>
        <SettingRow label="Grid size" description="Spacing between grid points, in canvas units.">
          {(props) => (
            <div className="flex w-56 items-center gap-3">
              <Slider
                {...props}
                aria-label="Grid size"
                min={4}
                max={100}
                step={1}
                value={[gridSize]}
                onValueChange={([value]) => value !== undefined && setGridSize(value)}
                onValueCommit={([value]) => value !== undefined && void save({ grid: { size: value } })}
              />
              <span className="w-10 text-right text-sm tabular-nums text-muted-foreground" aria-hidden>
                {gridSize}px
              </span>
            </div>
          )}
        </SettingRow>
      </SettingsSection>
      <SettingsSection title="Snapping">
        <SwitchRow
          label="Snap to grid"
          checked={snapping.toGrid}
          onCheckedChange={(toGrid) => void save({ snapping: { toGrid } })}
          testId="canvas-snap-grid"
        />
        <SwitchRow
          label="Snap to objects"
          description="Align to edges and centers of nearby shapes."
          checked={snapping.toObjects}
          onCheckedChange={(toObjects) => void save({ snapping: { toObjects } })}
          testId="canvas-snap-objects"
        />
        <SwitchRow
          label="Snap angles"
          description="Snap rotation and line angles to common increments."
          checked={snapping.angle}
          onCheckedChange={(angle) => void save({ snapping: { angle } })}
          testId="canvas-snap-angle"
        />
      </SettingsSection>
      <SettingsSection title="Navigation & input">
        <SwitchRow
          label="Zoom with scroll wheel"
          description="Scroll to zoom instead of panning the canvas."
          checked={canvas.zoomWithWheel}
          onCheckedChange={(zoomWithWheel) => void save({ canvas: { zoomWithWheel } })}
          testId="canvas-zoom-wheel"
        />
        <SwitchRow
          label="Show minimap"
          checked={canvas.showMinimap}
          onCheckedChange={(showMinimap) => void save({ canvas: { showMinimap } })}
          testId="canvas-minimap"
        />
        <SwitchRow
          label="Pen mode"
          description="With a stylus, draw with the pen and pan with your finger."
          checked={canvas.penMode}
          onCheckedChange={(penMode) => void save({ canvas: { penMode } })}
          testId="canvas-pen-mode"
        />
      </SettingsSection>
    </div>
  );
}
