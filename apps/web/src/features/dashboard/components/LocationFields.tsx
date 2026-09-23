import { FormField, NativeSelect } from '@inkflow/ui';
import { useFolders, useProjects } from '../hooks';
import { folderOptions, indentLabel, sortProjects } from './location-options';

export interface BoardLocation {
  projectId: string | null;
  folderId: string | null;
}

/** Project + folder pickers for creating or moving a board. */
export function LocationFields({
  workspaceId,
  value,
  onChange,
}: {
  workspaceId: string;
  value: BoardLocation;
  onChange: (value: BoardLocation) => void;
}) {
  const projects = useProjects(workspaceId);
  const folders = useFolders(workspaceId);
  const options = folderOptions(folders.data ?? [], value.projectId);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField label="Project">
        <NativeSelect
          value={value.projectId ?? ''}
          onChange={(e) => onChange({ projectId: e.target.value || null, folderId: null })}
          data-testid="location-project"
          wrapperClassName="w-full"
        >
          <option value="">No project</option>
          {sortProjects(projects.data ?? []).map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField label="Folder">
        <NativeSelect
          value={value.folderId ?? ''}
          onChange={(e) => onChange({ ...value, folderId: e.target.value || null })}
          disabled={options.length === 0}
          data-testid="location-folder"
          wrapperClassName="w-full"
        >
          <option value="">{options.length === 0 ? 'No folders' : 'No folder'}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {indentLabel(option)}
            </option>
          ))}
        </NativeSelect>
      </FormField>
    </div>
  );
}
