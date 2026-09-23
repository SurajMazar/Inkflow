import { detectPlatform, formatShortcut, type ShortcutCategory } from '@inkflow/canvas-engine';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Kbd,
} from '@inkflow/ui';
import { Search } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router';
import { useEditor } from '../hooks/editor-context';

const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  tools: 'Tools',
  edit: 'Edit',
  view: 'View',
  arrange: 'Arrange',
  text: 'Text',
  navigation: 'Navigation',
  diagram: 'Diagrams',
};
const CATEGORY_ORDER: ShortcutCategory[] = [
  'tools',
  'edit',
  'arrange',
  'view',
  'text',
  'navigation',
  'diagram',
];

interface Gesture {
  label: string;
  keys: string[];
}

function gestures(mac: boolean): Gesture[] {
  const mod = mac ? '⌘' : 'Ctrl';
  const alt = mac ? '⌥' : 'Alt';
  return [
    { label: 'Pan the canvas', keys: ['Space + drag', 'Middle-drag', 'Two-finger drag'] },
    { label: 'Zoom', keys: [`${mod} + scroll`, 'Pinch'] },
    { label: 'Duplicate while dragging', keys: [`${alt} + drag`] },
    { label: 'Constrain proportions / angles', keys: ['Shift + drag'] },
    { label: 'Resize from the center', keys: [`${alt} + resize`] },
    { label: 'Disable snapping while dragging', keys: [`${mod} + drag`] },
    { label: 'Select the element behind', keys: [`${alt} + click`] },
    { label: 'Select inside a group (deep select)', keys: [`${mod} + click`, 'Double-click'] },
    { label: 'Add to / remove from selection', keys: ['Shift + click'] },
    { label: 'Context menu', keys: ['Right-click', 'Long-press'] },
  ];
}

/** Searchable list of the effective keyboard shortcuts plus pointer gestures. */
export function ShortcutsDialog({ onClose }: { onClose(): void }) {
  const editor = useEditor();
  const [query, setQuery] = React.useState('');
  const platform = React.useMemo(() => detectPlatform(), []);
  const all = React.useMemo(() => editor.shortcuts.effective(), [editor]);
  const q = query.trim().toLowerCase();

  const groups = React.useMemo(() => {
    const matches = all.filter((s) => {
      if (!q) return true;
      const keys = s.keys.map((k) => formatShortcut(k, platform)).join(' ');
      return `${s.label} ${s.id} ${keys} ${s.keys.join(' ')}`.toLowerCase().includes(q);
    });
    return CATEGORY_ORDER.map((c) => ({
      category: c,
      items: matches.filter((s) => s.category === c),
    })).filter((g) => g.items.length > 0);
  }, [all, q, platform]);
  const gestureList = gestures(platform === 'mac').filter(
    (g) => !q || `${g.label} ${g.keys.join(' ')}`.toLowerCase().includes(q),
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[85dvh] flex-col gap-3 sm:max-w-3xl"
        data-inkflow-ui
        data-testid="shortcuts-dialog"
      >
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Customize them in{' '}
            <Link
              to="/settings/shortcuts"
              className="text-primary underline-offset-4 hover:underline"
              onClick={onClose}
            >
              Settings → Shortcuts
            </Link>
            .
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search shortcuts"
            aria-label="Search shortcuts"
            className="pl-8"
            autoFocus
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {groups.length === 0 && gestureList.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No shortcuts match “{query.trim()}”.
            </p>
          ) : (
            <div className="columns-1 gap-6 sm:columns-2">
              {groups.map((g) => (
                <section
                  key={g.category}
                  className="mb-4 break-inside-avoid"
                  aria-label={CATEGORY_LABELS[g.category]}
                >
                  <h3 className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    {CATEGORY_LABELS[g.category]}
                  </h3>
                  <ul>
                    {g.items.map((s) => (
                      <li
                        key={s.id}
                        className="flex items-center justify-between gap-3 border-b border-border/50 py-1.5 text-sm last:border-0"
                      >
                        <span>{s.label}</span>
                        <span className="flex shrink-0 gap-1">
                          {s.keys.map((k) => (
                            <Kbd key={k}>{formatShortcut(k, platform)}</Kbd>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {gestureList.length > 0 && (
                <section className="mb-4 break-inside-avoid" aria-label="Mouse and touch">
                  <h3 className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    Mouse & touch
                  </h3>
                  <ul>
                    {gestureList.map((g) => (
                      <li
                        key={g.label}
                        className="flex items-center justify-between gap-3 border-b border-border/50 py-1.5 text-sm last:border-0"
                      >
                        <span>{g.label}</span>
                        <span className="flex shrink-0 flex-wrap justify-end gap-1">
                          {g.keys.map((k) => (
                            <Kbd key={k}>{k}</Kbd>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
