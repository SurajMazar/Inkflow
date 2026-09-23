export type ShortcutCategory = 'tools' | 'edit' | 'view' | 'arrange' | 'text' | 'navigation' | 'diagram';

export interface ShortcutDefinition {
  /** Action id dispatched by the editor. */
  id: string;
  label: string;
  category: ShortcutCategory;
  /** Key combos, e.g. `Mod+Z`, `Shift+Mod+Z`, `V`, `Alt+Shift+H`. `Mod` = ⌘ on macOS, Ctrl elsewhere. */
  keys: string[];
}

export const DEFAULT_SHORTCUTS: readonly ShortcutDefinition[] = [
  // Tools
  { id: 'tool.selection', label: 'Selection', category: 'tools', keys: ['V', '1'] },
  { id: 'tool.hand', label: 'Hand (pan)', category: 'tools', keys: ['H'] },
  { id: 'tool.rectangle', label: 'Rectangle', category: 'tools', keys: ['R', '2'] },
  { id: 'tool.roundedRectangle', label: 'Rounded rectangle', category: 'tools', keys: ['Shift+R'] },
  { id: 'tool.diamond', label: 'Diamond', category: 'tools', keys: ['D', '3'] },
  { id: 'tool.ellipse', label: 'Ellipse', category: 'tools', keys: ['E', '4'] },
  { id: 'tool.triangle', label: 'Triangle', category: 'tools', keys: ['Shift+T'] },
  { id: 'tool.polygon', label: 'Polygon', category: 'tools', keys: ['Shift+P'] },
  { id: 'tool.star', label: 'Star', category: 'tools', keys: ['Shift+S'] },
  { id: 'tool.arrow', label: 'Arrow', category: 'tools', keys: ['A', '5'] },
  { id: 'tool.line', label: 'Line', category: 'tools', keys: ['L', '6'] },
  { id: 'tool.connector', label: 'Connector', category: 'tools', keys: ['C'] },
  { id: 'tool.pencil', label: 'Pencil', category: 'tools', keys: ['P', '7'] },
  { id: 'tool.brush', label: 'Brush', category: 'tools', keys: ['B'] },
  { id: 'tool.highlighter', label: 'Highlighter', category: 'tools', keys: ['Shift+B'] },
  { id: 'tool.eraser', label: 'Eraser', category: 'tools', keys: ['X', '0'] },
  { id: 'tool.text', label: 'Text', category: 'tools', keys: ['T', '8'] },
  { id: 'tool.image', label: 'Insert image', category: 'tools', keys: ['I', '9'] },
  { id: 'tool.frame', label: 'Frame', category: 'tools', keys: ['F'] },
  { id: 'tool.node', label: 'Diagram node', category: 'tools', keys: ['N'] },
  { id: 'tool.comment', label: 'Comment', category: 'tools', keys: ['M'] },
  { id: 'tool.laser', label: 'Laser pointer', category: 'tools', keys: ['K'] },
  { id: 'tool.lock', label: 'Keep tool active', category: 'tools', keys: ['Q'] },

  // Edit
  { id: 'edit.undo', label: 'Undo', category: 'edit', keys: ['Mod+Z'] },
  { id: 'edit.redo', label: 'Redo', category: 'edit', keys: ['Shift+Mod+Z', 'Mod+Y'] },
  { id: 'edit.copy', label: 'Copy', category: 'edit', keys: ['Mod+C'] },
  { id: 'edit.cut', label: 'Cut', category: 'edit', keys: ['Mod+X'] },
  { id: 'edit.paste', label: 'Paste', category: 'edit', keys: ['Mod+V'] },
  { id: 'edit.pasteInPlace', label: 'Paste in place', category: 'edit', keys: ['Shift+Mod+V'] },
  { id: 'edit.duplicate', label: 'Duplicate', category: 'edit', keys: ['Mod+D'] },
  { id: 'edit.delete', label: 'Delete', category: 'edit', keys: ['Delete', 'Backspace'] },
  { id: 'edit.selectAll', label: 'Select all', category: 'edit', keys: ['Mod+A'] },
  { id: 'edit.deselect', label: 'Cancel / deselect', category: 'edit', keys: ['Escape'] },
  { id: 'edit.copyStyles', label: 'Copy styles', category: 'edit', keys: ['Alt+Mod+C'] },
  { id: 'edit.pasteStyles', label: 'Paste styles', category: 'edit', keys: ['Alt+Mod+V'] },
  { id: 'edit.find', label: 'Find on canvas', category: 'edit', keys: ['Mod+F'] },

  // Arrange
  { id: 'arrange.group', label: 'Group', category: 'arrange', keys: ['Mod+G'] },
  { id: 'arrange.ungroup', label: 'Ungroup', category: 'arrange', keys: ['Shift+Mod+G'] },
  { id: 'arrange.bringForward', label: 'Bring forward', category: 'arrange', keys: ['Mod+]'] },
  { id: 'arrange.sendBackward', label: 'Send backward', category: 'arrange', keys: ['Mod+['] },
  { id: 'arrange.bringToFront', label: 'Bring to front', category: 'arrange', keys: ['Shift+Mod+]'] },
  { id: 'arrange.sendToBack', label: 'Send to back', category: 'arrange', keys: ['Shift+Mod+['] },
  { id: 'arrange.lock', label: 'Lock / unlock', category: 'arrange', keys: ['Shift+Mod+L'] },
  { id: 'arrange.hide', label: 'Hide', category: 'arrange', keys: ['Shift+Mod+H'] },
  { id: 'arrange.flipHorizontal', label: 'Flip horizontal', category: 'arrange', keys: ['Shift+H'] },
  { id: 'arrange.flipVertical', label: 'Flip vertical', category: 'arrange', keys: ['Shift+V'] },
  { id: 'arrange.alignLeft', label: 'Align left', category: 'arrange', keys: ['Alt+A'] },
  { id: 'arrange.alignCenter', label: 'Align center', category: 'arrange', keys: ['Alt+H'] },
  { id: 'arrange.alignRight', label: 'Align right', category: 'arrange', keys: ['Alt+D'] },
  { id: 'arrange.alignTop', label: 'Align top', category: 'arrange', keys: ['Alt+W'] },
  { id: 'arrange.alignMiddle', label: 'Align middle', category: 'arrange', keys: ['Alt+V'] },
  { id: 'arrange.alignBottom', label: 'Align bottom', category: 'arrange', keys: ['Alt+S'] },
  { id: 'arrange.distributeHorizontal', label: 'Distribute horizontally', category: 'arrange', keys: ['Alt+Shift+H'] },
  { id: 'arrange.distributeVertical', label: 'Distribute vertically', category: 'arrange', keys: ['Alt+Shift+V'] },

  // View
  { id: 'view.zoomIn', label: 'Zoom in', category: 'view', keys: ['Mod+=', 'Mod++'] },
  { id: 'view.zoomOut', label: 'Zoom out', category: 'view', keys: ['Mod+-'] },
  { id: 'view.resetZoom', label: 'Reset zoom', category: 'view', keys: ['Mod+0'] },
  { id: 'view.fitContent', label: 'Zoom to fit all', category: 'view', keys: ['Shift+1'] },
  { id: 'view.fitSelection', label: 'Zoom to selection', category: 'view', keys: ['Shift+2'] },
  { id: 'view.toggleGrid', label: 'Toggle grid', category: 'view', keys: ["Mod+'"] },
  { id: 'view.toggleSnap', label: 'Toggle snapping', category: 'view', keys: ['Alt+Shift+S'] },
  { id: 'view.toggleTheme', label: 'Toggle dark mode', category: 'view', keys: ['Alt+Shift+D'] },
  { id: 'view.zenMode', label: 'Zen mode', category: 'view', keys: ['Alt+Z'] },
  { id: 'view.present', label: 'Present frames', category: 'view', keys: ['Alt+P'] },
  { id: 'export.board', label: 'Export', category: 'view', keys: ['Shift+Mod+E'] },
  { id: 'view.shortcuts', label: 'Keyboard shortcuts', category: 'view', keys: ['?', 'Shift+/'] },
  { id: 'view.commandPalette', label: 'Command palette', category: 'view', keys: ['Mod+K', 'Mod+/'] },

  // Text
  { id: 'text.bold', label: 'Bold', category: 'text', keys: ['Mod+B'] },
  { id: 'text.italic', label: 'Italic', category: 'text', keys: ['Mod+I'] },
  { id: 'text.underline', label: 'Underline', category: 'text', keys: ['Mod+U'] },
  { id: 'text.increaseSize', label: 'Increase font size', category: 'text', keys: ['Shift+Mod+.'] },
  { id: 'text.decreaseSize', label: 'Decrease font size', category: 'text', keys: ['Shift+Mod+,'] },

  // Navigation
  { id: 'nav.nudgeLeft', label: 'Nudge left (Shift = 10×)', category: 'navigation', keys: ['ArrowLeft'] },
  { id: 'nav.nudgeRight', label: 'Nudge right', category: 'navigation', keys: ['ArrowRight'] },
  { id: 'nav.nudgeUp', label: 'Nudge up', category: 'navigation', keys: ['ArrowUp'] },
  { id: 'nav.nudgeDown', label: 'Nudge down', category: 'navigation', keys: ['ArrowDown'] },
  { id: 'nav.nextElement', label: 'Select next element', category: 'navigation', keys: ['Tab'] },
  { id: 'nav.previousElement', label: 'Select previous element', category: 'navigation', keys: ['Shift+Tab'] },
  { id: 'nav.editSelected', label: 'Edit text / enter group', category: 'navigation', keys: ['Enter'] },

  // Diagram
  { id: 'diagram.autoLayout', label: 'Auto layout selection', category: 'diagram', keys: ['Alt+Shift+L'] },
  { id: 'diagram.selectConnected', label: 'Select connected diagram', category: 'diagram', keys: ['Alt+Mod+A'] },
  { id: 'diagram.addConnected', label: 'Add connected node', category: 'diagram', keys: ['Mod+Enter'] },
  { id: 'diagram.library', label: 'Open shape library', category: 'diagram', keys: ['Shift+L'] },
];

/** Formats a key combo for display, e.g. `Shift+Mod+Z` → `⇧⌘Z` on macOS and `Ctrl+Shift+Z` elsewhere. */
export function formatShortcut(combo: string, platform: 'mac' | 'other'): string {
  const parts = combo.split('+').filter((p, i, arr) => p !== '' || (i === arr.length - 1 && combo.endsWith('++')));
  const keys = combo.endsWith('++') ? [...combo.slice(0, -2).split('+').filter(Boolean), '+'] : parts;
  const mods = new Set(keys.slice(0, -1));
  const key = keys[keys.length - 1] ?? '';
  const keyLabel: Record<string, string> = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Escape: 'Esc',
    Delete: platform === 'mac' ? '⌦' : 'Del',
    Backspace: platform === 'mac' ? '⌫' : 'Backspace',
    Enter: platform === 'mac' ? '↩' : 'Enter',
    Tab: platform === 'mac' ? '⇥' : 'Tab',
  };
  const label = keyLabel[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  if (platform === 'mac') {
    return `${mods.has('Ctrl') ? '⌃' : ''}${mods.has('Alt') ? '⌥' : ''}${mods.has('Shift') ? '⇧' : ''}${mods.has('Mod') ? '⌘' : ''}${label}`;
  }
  const out: string[] = [];
  if (mods.has('Mod') || mods.has('Ctrl')) out.push('Ctrl');
  if (mods.has('Alt')) out.push('Alt');
  if (mods.has('Shift')) out.push('Shift');
  out.push(label);
  return out.join('+');
}

export function detectPlatform(): 'mac' | 'other' {
  const nav = (globalThis as { navigator?: { platform?: string; userAgent?: string } }).navigator;
  const p = `${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`;
  return /Mac|iPhone|iPad|iPod/i.test(p) ? 'mac' : 'other';
}
