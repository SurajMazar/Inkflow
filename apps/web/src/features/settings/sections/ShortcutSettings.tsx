import * as React from 'react';
import { AlertTriangle, RotateCcw, Search } from 'lucide-react';
import {
  DEFAULT_SHORTCUTS,
  detectPlatform,
  formatShortcut,
  type ShortcutDefinition,
} from '@inkflow/canvas-engine';
import { Badge, Button, EmptyState, Input, Kbd, cn } from '@inkflow/ui';
import { SettingsSection, useSavePreferences } from '../components';
import {
  SHORTCUT_CATEGORY_LABELS,
  SHORTCUT_CATEGORY_ORDER,
  comboFromKeyboardEvent,
  effectiveKeys,
  findConflicts,
  isReservedCombo,
  resetOverride,
  setOverride,
  type Platform,
} from '../shortcuts';

interface Recording {
  actionId: string;
  combo: string | null;
  conflicts: ShortcutDefinition[];
  reserved: boolean;
}

export function ShortcutSettings() {
  const { preferences, save } = useSavePreferences();
  const overrides = preferences.shortcuts;
  const platform: Platform = React.useMemo(() => detectPlatform(), []);
  const [query, setQuery] = React.useState('');
  const [recording, setRecording] = React.useState<Recording | null>(null);
  const [announcement, setAnnouncement] = React.useState('');

  const saveOverrides = React.useCallback(
    async (next: Record<string, string>, message: string) => {
      const ok = await save({ shortcuts: next }, message);
      if (ok) setAnnouncement(message);
    },
    [save],
  );

  const commit = React.useCallback(
    (definition: ShortcutDefinition, combo: string) => {
      setRecording(null);
      void saveOverrides(
        setOverride(overrides, definition, combo, platform),
        `${definition.label}: ${formatShortcut(combo, platform)}`,
      );
    },
    [overrides, platform, saveOverrides],
  );

  // Capture the next key combo while recording.
  React.useEffect(() => {
    if (!recording || recording.combo) return;
    const definition = DEFAULT_SHORTCUTS.find((d) => d.id === recording.actionId);
    if (!definition) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (
        event.key === 'Escape' &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.ctrlKey
      ) {
        setRecording(null);
        setAnnouncement('Recording cancelled');
        return;
      }
      const combo = comboFromKeyboardEvent(event, platform);
      if (!combo) return;
      const conflicts = findConflicts(combo, definition.id, overrides, DEFAULT_SHORTCUTS, platform);
      const reserved = isReservedCombo(combo, platform);
      if (conflicts.length === 0 && !reserved) {
        commit(definition, combo);
      } else {
        setRecording({ actionId: definition.id, combo, conflicts, reserved });
        setAnnouncement(
          conflicts.length > 0
            ? `${formatShortcut(combo, platform)} is already used by ${conflicts.map((c) => c.label).join(', ')}`
            : `${formatShortcut(combo, platform)} is reserved by the browser`,
        );
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording, overrides, platform, commit]);

  const needle = query.trim().toLowerCase();
  const groups = SHORTCUT_CATEGORY_ORDER.map((category) => ({
    category,
    items: DEFAULT_SHORTCUTS.filter(
      (d) =>
        d.category === category &&
        (!needle ||
          d.label.toLowerCase().includes(needle) ||
          d.id.toLowerCase().includes(needle) ||
          effectiveKeys(d, overrides).some(
            (k) =>
              k.toLowerCase().includes(needle) ||
              formatShortcut(k, platform).toLowerCase().includes(needle),
          )),
    ),
  })).filter((g) => g.items.length > 0);
  const customizedCount = Object.keys(overrides).length;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-48 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search shortcuts"
            aria-label="Search shortcuts"
            className="pl-8"
            data-testid="shortcuts-search"
          />
        </div>
        {customizedCount > 0 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void saveOverrides({}, 'All shortcuts reset')}
            data-testid="shortcuts-reset-all"
          >
            <RotateCcw aria-hidden />
            Reset all ({customizedCount})
          </Button>
        ) : null}
      </div>
      <p className="sr-only" aria-live="assertive">
        {announcement}
      </p>
      {groups.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<Search />}
          title="No shortcuts found"
          description={`Nothing matches “${query}”.`}
        />
      ) : (
        groups.map((group) => (
          <SettingsSection key={group.category} title={SHORTCUT_CATEGORY_LABELS[group.category]}>
            <ul className="divide-y">
              {group.items.map((definition) => (
                <ShortcutRow
                  key={definition.id}
                  definition={definition}
                  keys={effectiveKeys(definition, overrides)}
                  customized={definition.id in overrides}
                  platform={platform}
                  recording={recording?.actionId === definition.id ? recording : null}
                  onRecord={() => {
                    setRecording({
                      actionId: definition.id,
                      combo: null,
                      conflicts: [],
                      reserved: false,
                    });
                    setAnnouncement(
                      `Recording shortcut for ${definition.label}. Press a key combination, or Escape to cancel.`,
                    );
                  }}
                  onCancel={() => setRecording(null)}
                  onConfirm={(combo) => commit(definition, combo)}
                  onReset={() =>
                    void saveOverrides(
                      resetOverride(overrides, definition.id),
                      `${definition.label} reset to default`,
                    )
                  }
                />
              ))}
            </ul>
          </SettingsSection>
        ))
      )}
    </div>
  );
}

function ShortcutRow({
  definition,
  keys,
  customized,
  platform,
  recording,
  onRecord,
  onCancel,
  onConfirm,
  onReset,
}: {
  definition: ShortcutDefinition;
  keys: string[];
  customized: boolean;
  platform: Platform;
  recording: Recording | null;
  onRecord: () => void;
  onCancel: () => void;
  onConfirm: (combo: string) => void;
  onReset: () => void;
}) {
  const waiting = recording && !recording.combo;
  return (
    <li
      className={cn('grid gap-2 px-4 py-2.5', recording && 'bg-brand-subtle/40')}
      data-testid="shortcut-row"
      data-action-id={definition.id}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 text-sm">
          {definition.label}
          {customized ? (
            <Badge variant="subtle" className="ml-2 align-middle">
              Custom
            </Badge>
          ) : null}
        </span>
        <span
          className="flex flex-wrap items-center gap-1.5"
          aria-label={`Current shortcut: ${keys.map((k) => formatShortcut(k, platform)).join(' or ')}`}
        >
          {waiting ? (
            <span className="animate-pulse text-[13px] text-muted-foreground">Press keys…</span>
          ) : (
            keys.map((combo) => (
              <Kbd key={combo} className="h-6 min-w-6 px-1.5 text-xs">
                {formatShortcut(combo, platform)}
              </Kbd>
            ))
          )}
        </span>
        <span className="flex items-center gap-1">
          {waiting ? (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRecord}
              disabled={!!recording}
              data-testid="shortcut-record"
            >
              Change
            </Button>
          )}
          {customized && !recording ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onReset}
              aria-label={`Reset ${definition.label} to default`}
              data-testid="shortcut-reset"
            >
              <RotateCcw aria-hidden />
            </Button>
          ) : null}
        </span>
      </div>
      {recording?.combo ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[13px]"
          role="alert"
          data-testid="shortcut-conflict"
        >
          <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
          <span className="min-w-0 flex-1">
            <Kbd className="mr-1">{formatShortcut(recording.combo, platform)}</Kbd>
            {recording.conflicts.length > 0
              ? `is already used by ${recording.conflicts.map((c) => c.label).join(', ')}.`
              : 'is reserved by the browser and may not work.'}
          </span>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => onConfirm(recording.combo!)}
            data-testid="shortcut-assign-anyway"
          >
            Assign anyway
          </Button>
        </div>
      ) : null}
    </li>
  );
}
