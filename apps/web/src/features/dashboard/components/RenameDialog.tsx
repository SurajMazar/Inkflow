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
  Spinner,
} from '@inkflow/ui';
import { describeApiError } from '@/features/notifications/notify';

export interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label: string;
  initialValue: string;
  maxLength?: number;
  submitLabel?: string;
  /** Resolve to close the dialog; reject to show the error inline. */
  onSubmit: (value: string) => Promise<unknown>;
}

/** Small single-field dialog used to rename boards, projects and folders (and to create them). */
export function RenameDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  initialValue,
  maxLength = 200,
  submitLabel = 'Save',
  onSubmit,
}: RenameDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <RenameForm
            title={title}
            description={description}
            label={label}
            initialValue={initialValue}
            maxLength={maxLength}
            submitLabel={submitLabel}
            onSubmit={onSubmit}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  title,
  description,
  label,
  initialValue,
  maxLength,
  submitLabel,
  onSubmit,
  onDone,
}: Omit<RenameDialogProps, 'open' | 'onOpenChange'> & { onDone: () => void }) {
  const [value, setValue] = React.useState(initialValue);
  const [error, setError] = React.useState<string | undefined>();
  const [pending, setPending] = React.useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setError(`${label} is required`);
      return;
    }
    if (trimmed === initialValue.trim() && initialValue) {
      onDone();
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      await onSubmit(trimmed);
      onDone();
    } catch (err) {
      const { title: message, description: detail } = describeApiError(err, 'Something went wrong');
      setError(detail && message.startsWith('Please') ? detail : message);
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{label}</DialogDescription>}
      </DialogHeader>
      <FormField label={label} error={error}>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={maxLength}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          data-testid="rename-input"
        />
      </FormField>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} data-testid="rename-submit">
          {pending ? <Spinner className="text-current" label={null} /> : null}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
