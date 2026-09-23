import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button, FormField, Input, Spinner } from '@inkflow/ui';
import { ApiError, passwordSchema } from '@inkflow/shared';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/lib/use-document-title';
import { describeApiError, notify } from '@/features/notifications/notify';
import { AuthLayout, FormAlert } from '../AuthLayout';
import { PasswordStrength } from '../PasswordStrength';

export function ResetPasswordPage() {
  useDocumentTitle('Choose a new password');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [errors, setErrors] = React.useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = React.useState<{ title: string; description?: string; invalidToken?: boolean } | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const footer = (
    <Link className="font-medium text-foreground underline-offset-4 hover:underline" to="/login">
      Back to sign in
    </Link>
  );

  if (token.length < 16) {
    return (
      <AuthLayout title="This reset link is invalid" description="Request a new link to reset your password." footer={footer}>
        <Button asChild className="w-full">
          <Link to="/forgot-password">Request a new link</Link>
        </Button>
      </AuthLayout>
    );
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const parsed = passwordSchema.safeParse(password);
    const nextErrors: typeof errors = {};
    if (!parsed.success) nextErrors.password = parsed.error.issues[0]?.message;
    if (confirm !== password) nextErrors.confirm = "Passwords don't match";
    setErrors(nextErrors);
    if (nextErrors.password || nextErrors.confirm) return;
    setSubmitting(true);
    try {
      await api.auth.resetPassword({ token, password });
      notify.success('Password updated', { description: 'Sign in with your new password.' });
      navigate('/login', { replace: true });
    } catch (error) {
      const invalidToken = error instanceof ApiError && (error.code === 'TOKEN_INVALID' || error.code === 'TOKEN_EXPIRED');
      setFormError({ ...describeApiError(error, "Couldn't reset your password"), invalidToken });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout title="Choose a new password" description="You'll be signed out of all other devices." footer={footer}>
      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        {formError ? (
          <FormAlert>
            <p className="font-medium">{formError.title}</p>
            {formError.description ? <p className="mt-0.5 opacity-90">{formError.description}</p> : null}
            {formError.invalidToken ? (
              <Link to="/forgot-password" className="mt-1 inline-block font-medium underline underline-offset-4">
                Request a new link
              </Link>
            ) : null}
          </FormAlert>
        ) : null}
        <FormField label="New password" error={errors.password}>
          {(controlProps) => (
            <>
              <Input
                {...controlProps}
                type="password"
                autoComplete="new-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="reset-password"
              />
              <PasswordStrength password={password} />
            </>
          )}
        </FormField>
        <FormField label="Confirm password" error={errors.confirm}>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            data-testid="reset-password-confirm"
          />
        </FormField>
        <Button type="submit" disabled={submitting} data-testid="reset-password-submit">
          {submitting ? <Spinner className="text-current" label={null} /> : null}
          Update password
        </Button>
      </form>
    </AuthLayout>
  );
}

export default ResetPasswordPage;
