import { detectPlatform, formatShortcut } from '@inkflow/canvas-engine';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@inkflow/ui';
import * as React from 'react';
import { useBoardSession } from '../hooks/editor-context';
import { useEditorUi, type EditorPanel } from '../hooks/ui-store';

/** Actions that need a payload or are too granular to be useful as commands. */
const HIDDEN_ACTIONS = new Set([
  'arrange.show',
  'view.commandPalette',
  'nav.nudgeLeft',
  'nav.nudgeRight',
  'nav.nudgeUp',
  'nav.nudgeDown',
]);

const GROUPS: { prefix: string; label: string }[] = [
  { prefix: 'tool.', label: 'Tools' },
  { prefix: 'edit.', label: 'Edit' },
  { prefix: 'arrange.', label: 'Arrange' },
  { prefix: 'frame.', label: 'Frames' },
  { prefix: 'text.', label: 'Text' },
  { prefix: 'diagram.', label: 'Diagrams' },
  { prefix: 'element.', label: 'Element' },
  { prefix: 'nav.', label: 'Navigation' },
  { prefix: 'view.', label: 'View' },
  { prefix: 'export.', label: 'Export' },
];

const PANELS: { id: EditorPanel; label: string; keywords: string[] }[] = [
  { id: 'comments', label: 'Comments', keywords: ['discussion', 'feedback'] },
  { id: 'versions', label: 'Version history', keywords: ['history', 'restore', 'backup'] },
  { id: 'search', label: 'Find on canvas', keywords: ['search'] },
  { id: 'library', label: 'Library & templates', keywords: ['shapes', 'templates', 'mermaid'] },
  { id: 'layers', label: 'Layers', keywords: ['elements', 'z-order', 'hidden'] },
  { id: 'frames', label: 'Frames', keywords: ['slides', 'presentation'] },
  { id: 'structure', label: 'Diagram structure editor', keywords: ['table', 'class', 'sequence'] },
];

function titleCase(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

interface Command {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  keywords: string[];
  run(): void;
}

/** Fuzzy-searchable list of every enabled editor action plus panels, import/export and presenting. */
export function CommandPalette({ onClose }: { onClose(): void }) {
  const { editor, canEdit } = useBoardSession();
  const platform = React.useMemo(() => detectPlatform(), []);

  const commands = React.useMemo<Command[]>(() => {
    const ui = useEditorUi.getState();
    const shortcuts = new Map(editor.shortcuts.effective().map((s) => [s.id, s]));
    const out: Command[] = [];
    for (const action of editor.actions.list()) {
      if (HIDDEN_ACTIONS.has(action.id) || !editor.actions.isEnabled(action.id)) continue;
      const def = shortcuts.get(action.id);
      const group = GROUPS.find((g) => action.id.startsWith(g.prefix))?.label ?? 'Other';
      const base = def?.label ?? titleCase(action.label);
      const label =
        action.id.startsWith('tool.') && action.id !== 'tool.lock' ? `Tool: ${base}` : base;
      const checked = editor.actions.isChecked(action.id);
      out.push({
        id: action.id,
        label: action.checked ? `${label}${checked ? ' (on)' : ' (off)'}` : label,
        group,
        shortcut: def?.keys[0] ? formatShortcut(def.keys[0], platform) : undefined,
        keywords: [action.id, action.label],
        run: () => editor.actions.run(action.id),
      });
    }
    for (const p of PANELS) {
      if (p.id === 'structure' && !canEdit) continue;
      out.push({
        id: `panel.${p.id}`,
        label: `Show ${p.label.toLowerCase()}`,
        group: 'Panels',
        keywords: p.keywords,
        run: () => ui.setPanel(p.id),
      });
    }
    out.push(
      {
        id: 'dialog.export',
        label: 'Export…',
        group: 'File',
        keywords: ['png', 'svg', 'pdf', 'json', 'download'],
        run: () => ui.openExport('board'),
      },
      {
        id: 'dialog.present',
        label: 'Present frames',
        group: 'File',
        keywords: ['slides', 'presentation', 'fullscreen'],
        run: () => editor.startPresentation(),
      },
      {
        id: 'dialog.shortcuts',
        label: 'Keyboard shortcuts',
        group: 'Help',
        keywords: ['keys', 'help'],
        run: () => ui.openDialog('shortcuts'),
      },
    );
    if (canEdit) {
      out.push(
        {
          id: 'dialog.import',
          label: 'Import file…',
          group: 'File',
          keywords: ['open', 'excalidraw', 'svg', 'mermaid', 'image'],
          run: () => ui.openDialog('import'),
        },
        {
          id: 'dialog.mermaid',
          label: 'Insert diagram from text (Mermaid)…',
          group: 'File',
          keywords: ['mermaid', 'text', 'code'],
          run: () => ui.openDialog('mermaid'),
        },
      );
    }
    return out;
  }, [editor, canEdit, platform]);

  const groups = React.useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const c of commands) {
      const list = map.get(c.group) ?? [];
      list.push(c);
      map.set(c.group, list);
    }
    return [...map.entries()];
  }, [commands]);

  const run = (command: Command) => {
    onClose();
    // Run after the palette closed so actions that open other dialogs or move focus are not undone.
    setTimeout(() => command.run(), 0);
  };

  return (
    <CommandDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Command palette"
      description="Search for an action to run"
    >
      <div data-testid="command-palette" data-inkflow-ui className="contents">
        <CommandInput placeholder="Type a command or search…" />
        <CommandList className="max-h-[60dvh]">
          <CommandEmpty>No matching commands.</CommandEmpty>
          {groups.map(([group, list]) => (
            <CommandGroup key={group} heading={group}>
              {list.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.label} ${c.id}`}
                  keywords={c.keywords}
                  onSelect={() => run(c)}
                  data-testid={`command-${c.id}`}
                >
                  <span className="truncate">{c.label}</span>
                  {c.shortcut && <CommandShortcut>{c.shortcut}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </div>
    </CommandDialog>
  );
}
