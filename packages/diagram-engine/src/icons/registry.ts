import type { IconDefinition } from '../types';
import { BUILTIN_ICONS } from './icons';

/** Extensible registry of 24×24 stroke icons, keyed by `NodeElement.icon`. */
export class IconRegistry {
  private readonly icons = new Map<string, IconDefinition>();

  constructor(definitions: readonly IconDefinition[] = []) {
    for (const def of definitions) this.register(def);
  }

  /** Adds or replaces an icon. Path data is geometry only and is never evaluated. */
  register(def: IconDefinition): void {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(def.key)) throw new Error(`Invalid icon key "${def.key}"`);
    const valid = (d: string) => d.length > 0 && d.length <= 10_000 && /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/.test(d);
    if (def.paths.length === 0 && !(def.fills && def.fills.length > 0)) throw new Error(`Icon "${def.key}" has no paths`);
    if (!def.paths.every(valid) || !(def.fills ?? []).every(valid)) throw new Error(`Icon "${def.key}" has invalid path data`);
    this.icons.set(def.key, def);
  }

  get(key: string): IconDefinition | undefined {
    return this.icons.get(key);
  }

  has(key: string): boolean {
    return this.icons.has(key);
  }

  list(category?: string): IconDefinition[] {
    const all = [...this.icons.values()];
    return category ? all.filter((d) => d.category === category) : all;
  }

  /** Case-insensitive search over key, label and keywords. */
  search(query: string): IconDefinition[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.list();
    return this.list().filter(
      (d) => d.key.includes(q) || d.label.toLowerCase().includes(q) || d.keywords.some((k) => k.includes(q)),
    );
  }
}

/** Registry pre-populated with the built-in icon set. */
export const iconRegistry = new IconRegistry(BUILTIN_ICONS);
