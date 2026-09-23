import * as React from 'react';
import { useNavigate } from 'react-router';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Spinner,
} from '@inkflow/ui';
import { createWorkspaceSchema, type WorkspaceDto } from '@inkflow/shared';
import { describeApiError, notify } from '@/features/notifications/notify';
import { useCreateWorkspace } from './hooks';
import { setLastWorkspaceId } from './last-workspace';

export interface CreateWorkspaceFormProps {
  onCreated?: (workspace: WorkspaceDto) => void;
  /** Rendered next to the submit button (e.g. Cancel). */
  secondaryAction?: React.ReactNode;
  submitLabel?: string;
  autoFocus?: boolean;
}

/** Workspace name form; navigates to the new workspace unless `onCreated` is provided. */
export function CreateWorkspaceForm({
  onCreated,
  secondaryAction,
  submitLabel = 'Create workspace',
  autoFocus = true,
}: CreateWorkspaceFormProps) {
  const [name, setName] = React.useState('');
  const [error, setError] = React.useState<string | undefined>();
  const create = useCreateWorkspace();
  const navigate = useNavigate();

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = createWorkspaceSchema.safeParse({ name });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.code === 'too_small'
          ? 'Give your workspace a name'
          : parsed.error.issues[0]?.message,
      );
      return;
    }
    setError(undefined);
    create.mutate(parsed.data, {
      onSuccess: (workspace) => {
        setLastWorkspaceId(workspace.id);
        notify.success(`Created ${workspace.name}`);
        if (onCreated) onCreated(workspace);
        else navigate(`/w/${workspace.id}`);
      },
      onError: (err) => setError(describeApiError(err, "Couldn't create the workspace").title),
    });
  };

  return (
    <form className="grid gap-5" onSubmit={onSubmit} noValidate>
      <FormField
        label="Workspace name"
        error={error}
        description="Usually your team or company name. You can change it later."
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Design"
          maxLength={80}
          autoFocus={autoFocus}
          autoComplete="organization"
          data-testid="create-workspace-name"
        />
      </FormField>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {secondaryAction}
        <Button type="submit" disabled={create.isPending} data-testid="create-workspace-submit">
          {create.isPending ? <Spinner className="text-current" label={null} /> : null}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a workspace</DialogTitle>
          <DialogDescription>
            Workspaces hold your team's boards, projects and members.
          </DialogDescription>
        </DialogHeader>
        <CreateWorkspaceForm
          onCreated={(workspace) => {
            onOpenChange(false);
            navigate(`/w/${workspace.id}`);
          }}
          secondaryAction={
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
