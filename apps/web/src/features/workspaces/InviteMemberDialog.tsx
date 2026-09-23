import * as React from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  NativeSelect,
  Spinner,
} from '@inkflow/ui';
import { ApiError, inviteMemberSchema, type WorkspaceRole } from '@inkflow/shared';
import { describeApiError } from '@/features/notifications/notify';
import { useWorkspaceMemberMutations } from './hooks';

export interface InviteMemberDialogProps {
  workspaceId: string;
  workspaceName: string;
  myRole: WorkspaceRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InviteMemberDialog({ workspaceId, workspaceName, myRole, open, onOpenChange }: InviteMemberDialogProps) {
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<'ADMIN' | 'MEMBER'>('MEMBER');
  const [error, setError] = React.useState<string | undefined>();
  const { invite } = useWorkspaceMemberMutations(workspaceId);

  React.useEffect(() => {
    if (!open) {
      setEmail('');
      setRole('MEMBER');
      setError(undefined);
    }
  }, [open]);

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = inviteMemberSchema.safeParse({ email, role });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    invite.mutate(parsed.data, {
      onSuccess: () => onOpenChange(false),
      onError: (err) =>
        setError(
          err instanceof ApiError && err.code === 'CONFLICT'
            ? err.message || 'This person is already a member or has a pending invitation.'
            : describeApiError(err, "Couldn't send the invitation").title,
        ),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite to {workspaceName}</DialogTitle>
          <DialogDescription>
            People with an Inkflow account are added right away; others receive an email invitation.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={onSubmit} noValidate>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
            <FormField label="Email address" error={error}>
              <Input
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder="teammate@company.com"
                value={email}
                autoFocus
                onChange={(e) => setEmail(e.target.value)}
                data-testid="workspace-invite-email"
              />
            </FormField>
            <FormField label="Role">
              <NativeSelect
                value={role}
                onChange={(e) => setRole(e.target.value as 'ADMIN' | 'MEMBER')}
                data-testid="workspace-invite-role"
              >
                <option value="MEMBER">Member</option>
                {myRole === 'OWNER' || myRole === 'ADMIN' ? <option value="ADMIN">Admin</option> : null}
              </NativeSelect>
            </FormField>
          </div>
          <p className="text-[13px] text-muted-foreground">
            Members can create boards and see boards shared with the workspace. Admins can also manage members and settings.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={invite.isPending} data-testid="workspace-invite-submit">
              {invite.isPending ? <Spinner className="text-current" label={null} /> : null}
              Send invite
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
