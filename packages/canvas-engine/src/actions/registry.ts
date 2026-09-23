import type { Editor } from '../editor';

export interface Action<P = unknown> {
  id: string;
  label: string;
  /** Allowed in read-only (viewer) mode. */
  readOnlySafe?: boolean;
  /** Whether the action currently applies (menus disable it otherwise). */
  enabled?(editor: Editor): boolean;
  /** Whether a toggle action is currently on (checkmarks in menus). */
  checked?(editor: Editor): boolean;
  perform(editor: Editor, payload?: P): void;
}

export class ActionRegistry {
  private readonly actions = new Map<string, Action>();

  constructor(private readonly editor: Editor) {}

  register<P>(action: Action<P>): void {
    this.actions.set(action.id, action as Action);
  }

  get(id: string): Action | undefined {
    return this.actions.get(id);
  }

  list(): Action[] {
    return [...this.actions.values()];
  }

  isEnabled(id: string): boolean {
    const a = this.actions.get(id);
    if (!a) return false;
    if (this.editor.isReadOnly && !a.readOnlySafe) return false;
    return a.enabled ? a.enabled(this.editor) : true;
  }

  isChecked(id: string): boolean {
    return this.actions.get(id)?.checked?.(this.editor) ?? false;
  }

  /** Runs an action; returns false if unknown or disabled. */
  run(id: string, payload?: unknown): boolean {
    const a = this.actions.get(id);
    if (!a || !this.isEnabled(id)) return false;
    try {
      a.perform(this.editor, payload);
    } catch (error) {
      this.editor.host.onError?.(error, a.label);
      return false;
    }
    return true;
  }
}
