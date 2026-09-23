import type { Editor } from '../editor';
import { isEditableTarget } from '../interaction/controller';
import { DEFAULT_SHORTCUTS, detectPlatform, type ShortcutDefinition } from './defaults';

interface ParsedCombo {
  mod: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

/** Parses combos like `Shift+Mod+Z`, `Mod++`, `?`. */
export function parseCombo(combo: string): ParsedCombo {
  let rest = combo;
  let key = '';
  if (rest.endsWith('++')) {
    key = '+';
    rest = rest.slice(0, -2);
  }
  const parts = rest.split('+').filter(Boolean);
  if (!key) key = parts.pop() ?? '';
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return {
    mod: mods.has('mod') || mods.has('cmd') || mods.has('meta'),
    ctrl: mods.has('ctrl'),
    shift: mods.has('shift'),
    alt: mods.has('alt') || mods.has('option'),
    key: key.length === 1 ? key.toUpperCase() : key,
  };
}

const SHIFTED_SYMBOLS: Record<string, string> = {
  '?': '/',
  '+': '=',
  '>': '.',
  '<': ',',
  '{': '[',
  '}': ']',
  '!': '1',
  '@': '2',
};

/** Normalized key name of a keyboard event (layout-independent for letters and digits). */
export function eventKey(e: KeyboardEvent): string {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
  if (/^Numpad[0-9]$/.test(e.code)) return e.code.slice(6);
  if (e.code === 'BracketLeft') return '[';
  if (e.code === 'BracketRight') return ']';
  if (e.code === 'Equal') return '=';
  if (e.code === 'Minus') return '-';
  if (e.code === 'Period') return '.';
  if (e.code === 'Comma') return ',';
  if (e.code === 'Slash') return '/';
  if (e.code === 'Quote') return "'";
  const k = e.key;
  return k.length === 1 ? k.toUpperCase() : k;
}

export function comboMatches(combo: ParsedCombo, e: KeyboardEvent, mac: boolean): boolean {
  const modPressed = mac ? e.metaKey : e.ctrlKey;
  const ctrlPressed = mac ? e.ctrlKey : false;
  const key = eventKey(e);
  let wanted = combo.key;
  let wantShift = combo.shift;
  // Symbols that require Shift on US layouts (e.g. `?`) match their base key + Shift.
  if (SHIFTED_SYMBOLS[wanted]) {
    if (key === wanted) {
      wantShift = e.shiftKey;
    } else {
      wanted = SHIFTED_SYMBOLS[wanted]!;
      wantShift = true;
    }
  }
  if (combo.key === '+' && key === '=') wantShift = e.shiftKey;
  if (key !== wanted && !(combo.key === '+' && key === '=')) return false;
  return (
    modPressed === combo.mod &&
    ctrlPressed === combo.ctrl &&
    e.shiftKey === wantShift &&
    e.altKey === combo.alt
  );
}

/** Serializes a keyboard event into a combo string (used by the shortcut recorder). */
export function comboFromEvent(e: KeyboardEvent, mac = detectPlatform() === 'mac'): string | null {
  const key = eventKey(e);
  if (['Shift', 'Control', 'Alt', 'Meta', 'OS'].includes(key)) return null;
  const parts: string[] = [];
  if (mac && e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (mac ? e.metaKey : e.ctrlKey) parts.push('Mod');
  parts.push(key);
  return parts.join('+');
}

/** Routes keyboard input to the active tool and to registered actions via the keymap. */
export class ShortcutManager {
  private bindings: { id: string; combo: ParsedCombo }[] = [];
  private overrides: Record<string, string> = {};
  private readonly mac = detectPlatform() === 'mac';
  private enabled = true;

  constructor(private readonly editor: Editor) {
    this.rebuild();
  }

  /** User overrides: action id → single combo string. */
  setOverrides(overrides: Record<string, string>): void {
    this.overrides = { ...overrides };
    this.rebuild();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Effective shortcut list after overrides (for help/UI). */
  effective(): ShortcutDefinition[] {
    return DEFAULT_SHORTCUTS.map((s) =>
      this.overrides[s.id] ? { ...s, keys: [this.overrides[s.id]!] } : s,
    );
  }

  private rebuild() {
    this.bindings = [];
    for (const s of this.effective())
      for (const k of s.keys) this.bindings.push({ id: s.id, combo: parseCombo(k) });
  }

  attach(win: Window): () => void {
    const onKeyDown = (e: KeyboardEvent) => this.handle(e);
    win.addEventListener('keydown', onKeyDown);
    return () => win.removeEventListener('keydown', onKeyDown);
  }

  handle(e: KeyboardEvent): boolean {
    const editor = this.editor;
    if (!this.enabled || e.defaultPrevented) return false;
    if (editor.state.textEdit) return false;
    if (isEditableTarget(e.target)) return false;
    // Ignore keys while focus is inside UI overlays (dialogs, menus) that manage their own keys.
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('[role="dialog"],[role="menu"],[role="listbox"],[data-inkflow-ui-keys]'))
      return false;

    if (editor.state.presentation.active) return this.handlePresentation(e);

    if (editor.activeTool.onKeyDown(e)) {
      e.preventDefault();
      return true;
    }
    if (e.key === 'Escape' && editor.state.contextMenu) {
      editor.closeContextMenu();
      e.preventDefault();
      return true;
    }
    // Arrow keys: nudge (Shift = large step), or pan the canvas when nothing is selected.
    if (e.key.startsWith('Arrow') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (editor.state.selectedIds.length === 0) return false;
      const id = {
        ArrowLeft: 'nav.nudgeLeft',
        ArrowRight: 'nav.nudgeRight',
        ArrowUp: 'nav.nudgeUp',
        ArrowDown: 'nav.nudgeDown',
      }[e.key];
      if (id && editor.actions.run(id, { large: e.shiftKey })) {
        e.preventDefault();
        return true;
      }
      return false;
    }
    for (const b of this.bindings) {
      if (!comboMatches(b.combo, e, this.mac)) continue;
      // Single-key shortcuts never fire while a pointer interaction is in progress.
      if (!b.combo.mod && !b.combo.alt && editor.activeTool.isBusy() && b.id.startsWith('tool.'))
        continue;
      if (
        b.id === 'edit.copy' ||
        b.id === 'edit.cut' ||
        b.id === 'edit.paste' ||
        b.id === 'edit.pasteInPlace'
      ) {
        // Native clipboard events handle these so the system clipboard is used without prompts.
        if (b.id !== 'edit.pasteInPlace') return false;
      }
      if (editor.actions.run(b.id)) {
        e.preventDefault();
        return true;
      }
    }
    return false;
  }

  private handlePresentation(e: KeyboardEvent): boolean {
    const editor = this.editor;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
      case 'Enter':
        editor.nextFrame();
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
      case 'Backspace':
        editor.previousFrame();
        break;
      case 'Home':
        editor.goToFrame(0);
        break;
      case 'End':
        editor.goToFrame(editor.state.presentation.frameIds.length - 1);
        break;
      case 'Escape':
        editor.stopPresentation();
        break;
      case 'l':
      case 'L':
        editor.setTool(editor.state.tool === 'laser' ? 'selection' : 'laser');
        break;
      default:
        return false;
    }
    e.preventDefault();
    return true;
  }
}
