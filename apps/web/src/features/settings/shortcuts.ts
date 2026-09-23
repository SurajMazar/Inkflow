/**
 * Keyboard shortcut customization helpers. Combos use the canvas engine format
 * (`Ctrl` (macOS only) → `Alt` → `Shift` → `Mod` → key, e.g. `Shift+Mod+K`), and overrides are
 * stored in `preferences.shortcuts` as `actionId → single combo` (replacing the defaults of that
 * action, exactly as `ShortcutManager.setOverrides` expects).
 */
import type { ShortcutCategory, ShortcutDefinition } from '@inkflow/canvas-engine';

export type Platform = 'mac' | 'other';

export interface KeyEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'OS', 'AltGraph', 'CapsLock', 'Fn', 'Hyper', 'Super']);

const CODE_KEYS: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Equal: '=',
  Minus: '-',
  Period: '.',
  Comma: ',',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Space: 'Space',
};

/** Symbols typed with Shift on US layouts, mapped to their base key. */
const SHIFTED_SYMBOLS: Record<string, string> = {
  '?': '/',
  '+': '=',
  '>': '.',
  '<': ',',
  '{': '[',
  '}': ']',
  '!': '1',
  '@': '2',
  '#': '3',
  $: '4',
  '%': '5',
  '^': '6',
  '&': '7',
  '*': '8',
  '(': '9',
  ')': '0',
  _: '-',
  ':': ';',
  '"': "'",
  '|': '\\',
  '~': '`',
};

/** Layout-independent key name of a keyboard event (letters/digits by physical key). */
export function keyFromEvent(event: Pick<KeyEventLike, 'key' | 'code'>): string {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  if (/^Numpad[0-9]$/.test(event.code)) return event.code.slice(6);
  if (CODE_KEYS[event.code]) return CODE_KEYS[event.code]!;
  if (event.key === ' ') return 'Space';
  return event.key.length === 1 ? event.key.toUpperCase() : event.key;
}

/**
 * Serializes a keydown into a combo string (`Shift+Mod+K`). Returns null for modifier-only
 * presses. `Mod` is ⌘ on macOS and Ctrl elsewhere.
 */
export function comboFromKeyboardEvent(event: KeyEventLike, platform: Platform): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const key = keyFromEvent(event);
  if (!key || key === 'Unidentified' || key === 'Dead') return null;
  const mac = platform === 'mac';
  const parts: string[] = [];
  if (mac && event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (mac ? event.metaKey : event.ctrlKey) parts.push('Mod');
  parts.push(key);
  return parts.join('+');
}

interface ParsedCombo {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  mod: boolean;
  key: string;
}

export function parseCombo(combo: string, platform: Platform): ParsedCombo {
  let rest = combo.trim();
  let key = '';
  if (rest.endsWith('++')) {
    key = '+';
    rest = rest.slice(0, -2);
  } else if (rest === '+') {
    key = '+';
    rest = '';
  }
  const parts = rest.split('+').filter(Boolean);
  if (!key) key = parts.pop() ?? '';
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const ctrlIsMod = platform !== 'mac';
  const parsed: ParsedCombo = {
    ctrl: !ctrlIsMod && mods.has('ctrl'),
    alt: mods.has('alt') || mods.has('option'),
    shift: mods.has('shift'),
    mod: mods.has('mod') || mods.has('cmd') || mods.has('meta') || (ctrlIsMod && mods.has('ctrl')),
    key: key.length === 1 ? key.toUpperCase() : key,
  };
  if (SHIFTED_SYMBOLS[parsed.key]) {
    parsed.key = SHIFTED_SYMBOLS[parsed.key]!;
    parsed.shift = true;
  }
  return parsed;
}

/** Canonical form used to compare combos (`?` ≡ `Shift+/`, `Ctrl` ≡ `Mod` off macOS). */
export function normalizeCombo(combo: string, platform: Platform): string {
  const p = parseCombo(combo, platform);
  return [p.ctrl && 'Ctrl', p.alt && 'Alt', p.shift && 'Shift', p.mod && 'Mod', p.key].filter(Boolean).join('+');
}

/** Keys bound to an action after applying overrides. */
export function effectiveKeys(definition: ShortcutDefinition, overrides: Record<string, string>): string[] {
  const override = overrides[definition.id];
  return override ? [override] : definition.keys;
}

/** Other actions already bound to `combo` (taking overrides into account). */
export function findConflicts(
  combo: string,
  actionId: string,
  overrides: Record<string, string>,
  definitions: readonly ShortcutDefinition[],
  platform: Platform,
): ShortcutDefinition[] {
  const wanted = normalizeCombo(combo, platform);
  return definitions.filter(
    (d) => d.id !== actionId && effectiveKeys(d, overrides).some((k) => normalizeCombo(k, platform) === wanted),
  );
}

/** Combos the browser or OS reserves; binding them is allowed but will likely not work. */
const RESERVED = ['Mod+W', 'Mod+T', 'Mod+N', 'Mod+Q', 'Shift+Mod+N', 'Shift+Mod+T', 'Shift+Mod+W', 'Mod+Tab'];

export function isReservedCombo(combo: string, platform: Platform): boolean {
  const normalized = normalizeCombo(combo, platform);
  return RESERVED.some((r) => normalizeCombo(r, platform) === normalized);
}

/** Returns new overrides with `actionId` bound to `combo` (or reset when equal to its default). */
export function setOverride(
  overrides: Record<string, string>,
  definition: ShortcutDefinition,
  combo: string,
  platform: Platform,
): Record<string, string> {
  const next = { ...overrides };
  const isDefault =
    definition.keys.length === 1 && normalizeCombo(definition.keys[0]!, platform) === normalizeCombo(combo, platform);
  if (isDefault) delete next[definition.id];
  else next[definition.id] = combo;
  return next;
}

export function resetOverride(overrides: Record<string, string>, actionId: string): Record<string, string> {
  const next = { ...overrides };
  delete next[actionId];
  return next;
}

export const SHORTCUT_CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  tools: 'Tools',
  edit: 'Edit',
  view: 'View',
  arrange: 'Arrange',
  text: 'Text',
  navigation: 'Navigation',
  diagram: 'Diagrams',
};

export const SHORTCUT_CATEGORY_ORDER: readonly ShortcutCategory[] = [
  'tools',
  'edit',
  'view',
  'arrange',
  'text',
  'navigation',
  'diagram',
];
