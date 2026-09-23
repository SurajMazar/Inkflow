import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { MailCheck } from 'lucide-react';
import { Button, FormField, Input, Spinner } from '@inkflow/ui';
import { ApiError, registerSchema } from '@inkflow/shared';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/lib/use-document-title';
import { serverFieldErrors, zodFieldErrors } from '@/lib/zod-errors';
import { describeApiError, notify } from '@/features/notifications/notify';
import { useAuth } from '../AuthProvider';
import { AuthLayout, FormAlert } from '../AuthLayout';
import { OAuthButtons } from '../OAuthButtons';
import { PasswordStrength } from '../PasswordStrength';
import { authRedirect, sanitizeNext } from '../next-param';

export function RegisterPage() {
  useDocumentTitle('Create account');
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = sanitizeNext(params.get('next'));
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState(params.get('email') ?? '');
  const [password, setPassword] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<{ title: string; description?: string } | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [sentTo, setSentTo] = React.useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const parsed = registerSchema.safeParse({ name, email, password });
    if (!parsed.success) {
      setFieldErrors(zodFieldErrors(parsed.error));
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const result = await register(parsed.data);
      if (result.requiresVerification) {
        setSentTo(parsed.data.email);
      } else {
        notify.success(`Welcome to Inkflow, ${result.user.name.split(' ')[0]}!`);
        navigate(next, { replace: true });
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
        const errors = serverFieldErrors(error.details);
        if (Object.keys(errors).length > 0) setFieldErrors(errors);
        else setFormError({ title: error.message });
      } else if (error instanceof ApiError && error.code === 'CONFLICT') {
        setFieldErrors({ email: 'An account with this email already exists.' });
      } else {
        setFormError(describeApiError(error, "Couldn't create your account"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (sentTo) {
    return (
      <AuthLayout
        title="Check your inbox"
        footer={
          <Link className="font-medium text-foreground underline-offset-4 hover:underline" to={authRedirect('/login', params.get('next'))}>
            Back to sign in
          </Link>
        }
      >
        <CheckInbox email={sentTo} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      description="Start sketching and diagramming together — it's free."
      footer={
        <>
          Already have an account?{' '}
          <Link className="font-medium text-foreground underline-offset-4 hover:underline" to={authRedirect('/login', params.get('next'))}>
            Sign in
          </Link>
        </>
      }
    >
      <div className="grid gap-5">
        <OAuthButtons next={next} />
        <form className="grid gap-4" onSubmit={onSubmit} noValidate>
          {formError ? (
            <FormAlert>
              <p className="font-medium">{formError.title}</p>
              {formError.description ? <p className="mt-0.5 opacity-90">{formError.description}</p> : null}
            </FormAlert>
          ) : null}
          <FormField label="Name" error={fieldErrors.name}>
            <Input
              name="name"
              autoComplete="name"
              autoFocus
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              data-testid="register-name"
            />
          </FormField>
          <FormField label="Email" error={fieldErrors.email}>
            <Input
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="register-email"
            />
          </FormField>
          <FormField label="Password" error={fieldErrors.password}>
            {(controlProps) => (
              <>
                <Input
                  {...controlProps}
                  aria-describedby={[controlProps['aria-describedby'], 'register-password-strength'].filter(Boolean).join(' ')}
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  data-testid="register-password"
                />
                <PasswordStrength password={password} id="register-password-strength" />
              </>
            )}
          </FormField>
          <Button type="submit" className="mt-1 w-full" disabled={submitting} data-testid="register-submit">
            {submitting ? <Spinner className="text-current" label={null} /> : null}
            {submitting ? 'Creating account…' : 'Create account'}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            By creating an account you agree to use Inkflow responsibly.
          </p>
        </form>
      </div>
    </AuthLayout>
  );
}

/** "We sent you a link" state with a resend button (shared with the verify page). */
export function CheckInbox({ email }: { email: string }) {
  const [sending, setSending] = React.useState(false);
  const [sentAgain, setSentAgain] = React.useState(false);
  const resend = async () => {
    setSending(true);
    try {
      await api.auth.resendVerification({ email });
      setSentAgain(true);
      notify.success('Verification email sent');
    } catch (error) {
      const { title, description } = describeApiError(error, "Couldn't send the email");
      notify.error(title, { description });
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="grid gap-5" data-testid="register-success" role="status">
      <div className="flex size-11 items-center justify-center rounded-xl border bg-brand-subtle text-brand-subtle-foreground">
        <MailCheck className="size-5" aria-hidden />
      </div>
      <p className="text-sm text-muted-foreground">
        We sent a verification link to <span className="font-medium text-foreground">{email}</span>. Open it to
        activate your account.
      </p>
      <div className="grid gap-2">
        <Button variant="outline" onClick={() => void resend()} disabled={sending || sentAgain} data-testid="register-resend">
          {sending ? <Spinner label={null} /> : null}
          {sentAgain ? 'Email sent — check your inbox' : 'Resend email'}
        </Button>
        <p className="text-center text-xs text-muted-foreground">Can't find it? Check your spam folder.</p>
      </div>
    </div>
  );
}

export default RegisterPage;
