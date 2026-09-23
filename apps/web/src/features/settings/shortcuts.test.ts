import { describe, expect, it } from 'vitest';
import { DEFAULT_SHORTCUTS, formatShortcut } from '@inkflow/canvas-engine';
import {
  comboFromKeyboardEvent,
  effectiveKeys,
  findConflicts,
  isReservedCombo,
  normalizeCombo,
  resetOverride,
  setOverride,
  type KeyEventLike,
} from './shortcuts';

const key = (overrides: Partial<KeyEventLike>): KeyEventLike => ({
  key: 'k',
  code: 'KeyK',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

describe('comboFromKeyboardEvent', () => {
  it('maps ⌘ to Mod on macOS and orders modifiers like the engine', () => {
    expect(comboFromKeyboardEvent(key({ metaKey: true, shiftKey: true }), 'mac')).toBe('Shift+Mod+K');
    expect(comboFromKeyboardEvent(key({ metaKey: true, altKey: true, key: 'å', code: 'KeyA' }), 'mac')).toBe('Alt+Mod+A');
    expect(comboFromKeyboardEvent(key({ ctrlKey: true, metaKey: true }), 'mac')).toBe('Ctrl+Mod+K');
  });

  it('maps Ctrl to Mod elsewhere', () => {
    expect(comboFromKeyboardEvent(key({ ctrlKey: true, shiftKey: true }), 'other')).toBe('Shift+Mod+K');
    expect(comboFromKeyboardEvent(key({ ctrlKey: true, key: '[', code: 'BracketLeft' }), 'other')).toBe('Mod+[');
  });

  it('uses physical keys for letters, digits and punctuation', () => {
    expect(comboFromKeyboardEvent(key({ key: '!', code: 'Digit1', shiftKey: true }), 'other')).toBe('Shift+1');
    expect(comboFromKeyboardEvent(key({ key: '?', code: 'Slash', shiftKey: true }), 'other')).toBe('Shift+/');
    expect(comboFromKeyboardEvent(key({ key: 'ArrowLeft', code: 'ArrowLeft' }), 'other')).toBe('ArrowLeft');
    expect(comboFromKeyboardEvent(key({ key: ' ', code: 'Space' }), 'other')).toBe('Space');
  });

  it('ignores modifier-only presses', () => {
    expect(comboFromKeyboardEvent(key({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }), 'mac')).toBeNull();
    expect(comboFromKeyboardEvent(key({ key: 'Meta', code: 'MetaLeft', metaKey: true }), 'mac')).toBeNull();
  });

  it('produces combos the engine formatter understands', () => {
    const combo = comboFromKeyboardEvent(key({ metaKey: true, shiftKey: true }), 'mac')!;
    expect(formatShortcut(combo, 'mac')).toBe('⇧⌘K');
    expect(formatShortcut('Shift+Mod+K', 'other')).toBe('Ctrl+Shift+K');
  });
});

describe('normalizeCombo', () => {
  it('treats equivalent spellings as equal', () => {
    expect(normalizeCombo('Mod+Shift+z', 'mac')).toBe(normalizeCombo('Shift+Mod+Z', 'mac'));
    expect(normalizeCombo('?', 'other')).toBe(normalizeCombo('Shift+/', 'other'));
    expect(normalizeCombo('Ctrl+K', 'other')).toBe(normalizeCombo('Mod+K', 'other'));
    expect(normalizeCombo('Ctrl+K', 'mac')).not.toBe(normalizeCombo('Mod+K', 'mac'));
    expect(normalizeCombo('Mod++', 'other')).toBe('Shift+Mod+=');
  });
});

describe('conflict detection', () => {
  it('finds actions already bound to a combo', () => {
    const conflicts = findConflicts('Mod+C', 'tool.rectangle', {}, DEFAULT_SHORTCUTS, 'other');
    expect(conflicts.map((c) => c.id)).toEqual(['edit.copy']);
  });

  it('respects overrides (moved shortcuts no longer conflict, new ones do)', () => {
    const overrides = { 'edit.copy': 'Alt+Shift+C' };
    expect(findConflicts('Mod+C', 'tool.rectangle', overrides, DEFAULT_SHORTCUTS, 'other')).toEqual([]);
    expect(findConflicts('Alt+Shift+C', 'tool.rectangle', overrides, DEFAULT_SHORTCUTS, 'other').map((c) => c.id)).toEqual([
      'edit.copy',
    ]);
  });

  it('never reports the action itself', () => {
    expect(findConflicts('Mod+Z', 'edit.undo', {}, DEFAULT_SHORTCUTS, 'mac')).toEqual([]);
  });

  it('matches shifted symbols against their base key', () => {
    expect(findConflicts('Shift+/', 'tool.hand', {}, DEFAULT_SHORTCUTS, 'other').map((c) => c.id)).toContain('view.shortcuts');
  });

  it('flags browser-reserved combos', () => {
    expect(isReservedCombo('Mod+W', 'mac')).toBe(true);
    expect(isReservedCombo('Mod+K', 'mac')).toBe(false);
  });
});

describe('overrides', () => {
  const rectangle = DEFAULT_SHORTCUTS.find((d) => d.id === 'tool.rectangle')!;
  const hand = DEFAULT_SHORTCUTS.find((d) => d.id === 'tool.hand')!;

  it('stores a single combo per action and resolves effective keys', () => {
    const next = setOverride({}, rectangle, 'Shift+Mod+K', 'mac');
    expect(next).toEqual({ 'tool.rectangle': 'Shift+Mod+K' });
    expect(effectiveKeys(rectangle, next)).toEqual(['Shift+Mod+K']);
    expect(effectiveKeys(rectangle, {})).toEqual(['R', '2']);
  });

  it('drops overrides equal to a single default and supports reset', () => {
    expect(setOverride({ 'tool.hand': 'J' }, hand, 'H', 'other')).toEqual({});
    expect(resetOverride({ 'tool.hand': 'J', 'tool.rectangle': 'G' }, 'tool.hand')).toEqual({ 'tool.rectangle': 'G' });
  });
});
