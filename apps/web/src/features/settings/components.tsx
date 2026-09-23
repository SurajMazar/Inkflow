import * as React from 'react';
import { Label, Switch, cn } from '@inkflow/ui';
import { usePreferences, type PreferencesPatch } from '@/features/auth/usePreferences';
import { notify } from '@/features/notifications/notify';

/** Saves preferences optimistically and confirms with a (de-duplicated) toast. */
export function useSavePreferences() {
  const { preferences, updatePreferences, isSaving } = usePreferences();
  const save = React.useCallback(
    async (patch: PreferencesPatch, message = 'Preferences saved') => {
      const ok = await updatePreferences(patch);
      if (ok) notify.success(message, { id: 'preferences-saved', duration: 1800 });
      return ok;
    },
    [updatePreferences],
  );
  return { preferences, save, isSaving };
}

export function SettingsSection({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id={id} className="text-base font-semibold">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="rounded-xl border">{children}</div>
    </section>
  );
}

export interface SettingRowProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  /** Render function receiving the id / aria-describedby for the control. */
  children: (props: { id: string; 'aria-describedby'?: string }) => React.ReactNode;
  className?: string;
  stacked?: boolean;
}

export function SettingRow({ label, description, children, className, stacked }: SettingRowProps) {
  const id = React.useId();
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <div
      className={cn(
        'flex gap-x-6 gap-y-3 border-b px-4 py-3.5 last:border-b-0',
        stacked ? 'flex-col' : 'flex-col sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <Label htmlFor={id} className="leading-snug">
          {label}
        </Label>
        {description ? (
          <p id={descriptionId} className="mt-1 text-[13px] text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div className="shrink-0">{children({ id, 'aria-describedby': descriptionId })}</div>
    </div>
  );
}

export function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  testId,
  disabled,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <SettingRow label={label} description={description} className="flex-row items-center justify-between">
      {(props) => (
        <Switch {...props} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} data-testid={testId} />
      )}
    </SettingRow>
  );
}
