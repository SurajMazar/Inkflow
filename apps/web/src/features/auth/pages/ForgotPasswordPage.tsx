import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import { MailCheck } from 'lucide-react';
import { Button, FormField, Input, Spinner } from '@inkflow/ui';
import { emailOnlySchema } from '@inkflow/shared';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/lib/use-document-title';
import { describeApiError } from '@/features/notifications/notify';
import { AuthLayout, FormAlert } from '../AuthLayout';

export function ForgotPasswordPage() {
  useDocumentTitle('Reset password');
  const [params] = useSearchParams();
  const [email, setEmail] = React.useState(params.get('email') ?? '');
  const [error, setError] = React.useState<string | undefined>();
  const [formError, setFormError] = React.useState<{ title: string; description?: string } | null>(
    null,
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [sentTo, setSentTo] = React.useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const parsed = emailOnlySchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    setSubmitting(true);
    try {
      await api.auth.forgotPassword(parsed.data);
      setSentTo(parsed.data.email);
    } catch (err) {
      setFormError(describeApiError(err, "Couldn't send the reset email"));
    } finally {
      setSubmitting(false);
    }
  };

  const footer = (
    <Link className="font-medium text-foreground underline-offset-4 hover:underline" to="/login">
      Back to sign in
    </Link>
  );

  if (sentTo) {
    return (
      <AuthLayout title="Check your inbox" footer={footer}>
        <div className="grid gap-4" role="status" data-testid="forgot-password-sent">
          <div className="flex size-11 items-center justify-center rounded-xl border bg-brand-subtle text-brand-subtle-foreground">
            <MailCheck className="size-5" aria-hidden />
          </div>
          <p className="text-sm text-muted-foreground">
            If an account exists for <span className="font-medium text-foreground">{sentTo}</span>,
            you'll receive a link to choose a new password shortly.
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Forgot your password?"
      description="Enter your email and we'll send you a link to reset it."
      footer={footer}
    >
      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        {formError ? (
          <FormAlert>
            <p className="font-medium">{formError.title}</p>
            {formError.description ? (
              <p className="mt-0.5 opacity-90">{formError.description}</p>
            ) : null}
          </FormAlert>
        ) : null}
        <FormField label="Email" error={error}>
          <Input
            type="email"
            autoComplete="email"
            inputMode="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="forgot-password-email"
          />
        </FormField>
        <Button type="submit" disabled={submitting} data-testid="forgot-password-submit">
          {submitting ? <Spinner className="text-current" label={null} /> : null}
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
}

export default ForgotPasswordPage;
