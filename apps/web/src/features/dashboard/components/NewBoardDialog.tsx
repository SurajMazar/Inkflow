import * as React from 'react';
import { useNavigate } from 'react-router';
import { FilePlus2, LayoutTemplate } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
  Spinner,
  cn,
} from '@inkflow/ui';
import { titleSchema, type TemplateSummaryDto } from '@inkflow/shared';
import { describeApiError } from '@/features/notifications/notify';
import { useBoardMutations, useTemplates } from '../hooks';
import { useDashboardUi } from '../ui-store';
import { LocationFields, type BoardLocation } from './LocationFields';
import { templateCategoryLabel } from './template-categories';

/** "New board" dialog (title, location, blank or template). Opened through `useDashboardUi().openNewBoard`. */
export function NewBoardDialog({ workspaceId }: { workspaceId: string }) {
  const { newBoard, closeNewBoard } = useDashboardUi();
  return (
    <Dialog open={newBoard.open} onOpenChange={(open) => !open && closeNewBoard()}>
      <DialogContent className="sm:max-w-lg">
        {newBoard.open ? (
          <NewBoardForm
            workspaceId={workspaceId}
            initialLocation={{ projectId: newBoard.defaults.projectId ?? null, folderId: newBoard.defaults.folderId ?? null }}
            initialTemplateId={newBoard.defaults.templateId ?? null}
            onDone={closeNewBoard}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NewBoardForm({
  workspaceId,
  initialLocation,
  initialTemplateId,
  onDone,
}: {
  workspaceId: string;
  initialLocation: BoardLocation;
  initialTemplateId: string | null;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const templates = useTemplates(workspaceId);
  const { create } = useBoardMutations();
  const [title, setTitle] = React.useState('');
  const [location, setLocation] = React.useState<BoardLocation>(initialLocation);
  const [templateId, setTemplateId] = React.useState<string>(initialTemplateId ?? 'blank');
  const [error, setError] = React.useState<string | undefined>();
  const [formError, setFormError] = React.useState<string | undefined>();

  const selectedTemplate = templates.data?.find((t) => t.id === templateId);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const finalTitle = title.trim() || selectedTemplate?.name || 'Untitled board';
    const parsed = titleSchema.safeParse(finalTitle);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    setFormError(undefined);
    create.mutate(
      {
        workspaceId,
        title: parsed.data,
        projectId: location.projectId,
        folderId: location.folderId,
        ...(templateId !== 'blank' ? { templateId } : {}),
      },
      {
        onSuccess: (board) => {
          onDone();
          navigate(`/b/${board.id}`);
        },
        onError: (err) => setFormError(describeApiError(err, "Couldn't create the board").title),
      },
    );
  };

  return (
    <form className="grid gap-5" onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>New board</DialogTitle>
        <DialogDescription>Start from a blank canvas or a template.</DialogDescription>
      </DialogHeader>
      <FormField label="Title" error={error}>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={selectedTemplate?.name ?? 'Untitled board'}
          maxLength={200}
          autoFocus
          data-testid="new-board-title"
        />
      </FormField>
      <LocationFields workspaceId={workspaceId} value={location} onChange={setLocation} />
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Start with</legend>
        {templates.isPending ? (
          <div className="grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : (
          <RadioGroup
            value={templateId}
            onValueChange={setTemplateId}
            className="grid max-h-56 grid-cols-1 gap-2 overflow-y-auto p-0.5 sm:grid-cols-2"
            aria-label="Template"
          >
            <TemplateOption value="blank" selected={templateId === 'blank'} title="Blank board" subtitle="Empty canvas" icon={<FilePlus2 aria-hidden />} />
            {(templates.data ?? []).map((template: TemplateSummaryDto) => (
              <TemplateOption
                key={template.id}
                value={template.id}
                selected={templateId === template.id}
                title={template.name}
                subtitle={templateCategoryLabel(template.category)}
                icon={<LayoutTemplate aria-hidden />}
              />
            ))}
          </RadioGroup>
        )}
      </fieldset>
      {formError ? (
        <p className="text-sm font-medium text-destructive" role="alert">
          {formError}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending} data-testid="new-board-submit">
          {create.isPending ? <Spinner className="text-current" label={null} /> : null}
          Create board
        </Button>
      </div>
    </form>
  );
}

function TemplateOption({
  value,
  selected,
  title,
  subtitle,
  icon,
}: {
  value: string;
  selected: boolean;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  const id = `template-option-${value}`;
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 transition-colors hover:bg-accent/60 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40',
        selected && 'border-primary/60 bg-brand-subtle/60',
      )}
    >
      <RadioGroupItem id={id} value={value} aria-label={title} className="sr-only" data-testid={`new-board-template-${value}`} />
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground [&_svg]:size-4',
          selected && 'text-brand-subtle-foreground',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
    </label>
  );
}
