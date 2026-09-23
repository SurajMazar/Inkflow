import type { FolderDto, ProjectDto } from '@inkflow/shared';

export interface FolderOption {
  id: string;
  label: string;
  depth: number;
}

/** Flattens the folder tree of a project (or the workspace root when `projectId` is null) depth-first. */
export function folderOptions(folders: readonly FolderDto[], projectId: string | null): FolderOption[] {
  const scoped = folders.filter((f) => (f.projectId ?? null) === projectId);
  const byParent = new Map<string | null, FolderDto[]>();
  for (const folder of scoped) {
    const parent = folder.parentId && scoped.some((f) => f.id === folder.parentId) ? folder.parentId : null;
    const list = byParent.get(parent) ?? [];
    list.push(folder);
    byParent.set(parent, list);
  }
  const out: FolderOption[] = [];
  const visit = (parent: string | null, depth: number, seen: Set<string>) => {
    const children = (byParent.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push({ id: child.id, label: child.name, depth });
      visit(child.id, depth + 1, seen);
    }
  };
  visit(null, 0, new Set());
  return out;
}

export function sortProjects(projects: readonly ProjectDto[]): ProjectDto[] {
  return [...projects].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Indents option labels for native `<select>`s. */
export function indentLabel(option: FolderOption): string {
  return `${'   '.repeat(option.depth)}${option.label}`;
}
