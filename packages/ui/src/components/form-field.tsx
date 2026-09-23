import * as React from 'react';
import { cn } from '../lib/cn';
import { Label } from './label';

/** Props injected into the control rendered inside a `FormField`. */
export interface FormFieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
}

export interface FormFieldProps {
  label: React.ReactNode;
  /** Help text rendered below the control. */
  description?: React.ReactNode;
  /** Validation message; marks the control invalid and is announced to screen readers. */
  error?: React.ReactNode;
  required?: boolean;
  /** Explicit id for the control; generated when omitted. */
  id?: string;
  className?: string;
  /** Element rendered at the end of the label row (e.g. a "Forgot password?" link). */
  labelAction?: React.ReactNode;
  /** Either a render function receiving the control props, or a single element to clone. */
  children: ((props: FormFieldControlProps) => React.ReactNode) | React.ReactElement<FormFieldControlProps>;
}

/**
 * Label + control + description/error text wired together with `htmlFor`, `aria-describedby`
 * and `aria-invalid`.
 */
export function FormField({ label, description, error, required, id, className, labelAction, children }: FormFieldProps) {
  const generatedId = React.useId();
  const controlId = id ?? `field-${generatedId}`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
  const controlProps: FormFieldControlProps = {
    id: controlId,
    'aria-describedby': describedBy,
    ...(error ? { 'aria-invalid': true as const } : {}),
    ...(required ? { 'aria-required': true as const } : {}),
  };
  const control =
    typeof children === 'function' ? children(controlProps) : React.cloneElement(children, controlProps);

  return (
    <div data-slot="form-field" className={cn('grid gap-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={controlId}>
          {label}
          {required ? (
            <span aria-hidden className="text-muted-foreground">
              *
            </span>
          ) : null}
        </Label>
        {labelAction}
      </div>
      {control}
      {description ? (
        <p id={descriptionId} className="text-[13px] text-muted-foreground">
          {description}
        </p>
      ) : null}
      <p
        id={errorId}
        aria-live="polite"
        className={cn('text-[13px] font-medium text-destructive', !error && 'sr-only')}
      >
        {error}
      </p>
    </div>
  );
}
