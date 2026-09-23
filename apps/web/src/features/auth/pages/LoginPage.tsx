import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button, FormField, Input, Spinner } from '@inkflow/ui';
import { ApiError, loginSchema } from '@inkflow/shared';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/lib/use-document-title';
import { zodFieldErrors } from '@/lib/zod-errors';
import { describeApiError, notify } from '@/features/notifications/notify';
import { useAuth } from '../AuthProvider';
import { AuthLayout, FormAlert } from '../AuthLayout';
import { OAuthButtons } from '../OAuthButtons';
import { authRedirect, sanitizeNext } from '../next-param';

type FormError =
  { kind: 'message'; title: string; description?: string } | { kind: 'unverified'; email: string };

export function LoginPage() {
  useDocumentTitle('Sign in');
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = sanitizeNext(params.get('next'));
  const [email, setEmail] = React.useState(params.get('email') ?? '');
  const [password, setPassword] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<FormError | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [resending, setResending] = React.useState(false);
  const [resent, setResent] = React.useState(false);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErrors(zodFieldErrors(parsed.error));
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      await login(parsed.data);
      navigate(next, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'EMAIL_NOT_VERIFIED') {
        setFormError({ kind: 'unverified', email: parsed.data.email });
      } else if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS') {
        setFormError({ kind: 'message', title: 'Incorrect email or password.' });
      } else {
        const { title, description } = describeApiError(error, "Couldn't sign you in");
        setFormError({ kind: 'message', title, description });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const resendVerification = async (address: string) => {
    setResending(true);
    try {
      await api.auth.resendVerification({ email: address });
      setResent(true);
      notify.success('Verification email sent', { description: `Check ${address} for the link.` });
    } catch (error) {
      const { title, description } = describeApiError(error, "Couldn't send the email");
      notify.error(title, { description });
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      description="Sign in to your Inkflow account."
      footer={
        <>
          New to Inkflow?{' '}
          <Link
            className="font-medium text-foreground underline-offset-4 hover:underline"
            to={authRedirect('/register', params.get('next'))}
          >
            Create an account
          </Link>
        </>
      }
    >
      <div className="grid gap-5">
        <OAuthButtons next={next} />
        <form
          className="grid gap-4"
          onSubmit={onSubmit}
          noValidate
          aria-describedby={formError ? 'login-error' : undefined}
        >
          {formError ? (
            <div id="login-error">
              {formError.kind === 'unverified' ? (
                <FormAlert variant="info">
                  <p className="font-medium">Please verify your email first.</p>
                  <p className="mt-1 text-muted-foreground">
                    We sent a verification link to {formError.email}.{' '}
                    {resent ? (
                      'A new link is on its way.'
                    ) : (
                      <button
                        type="button"
                        className="font-medium text-foreground underline underline-offset-4 disabled:opacity-60"
                        onClick={() => void resendVerification(formError.email)}
                        disabled={resending}
                        data-testid="login-resend-verification"
                      >
                        {resending ? 'Sending…' : 'Resend verification email'}
                      </button>
                    )}
                  </p>
                </FormAlert>
              ) : (
                <FormAlert>
                  <p className="font-medium">{formError.title}</p>
                  {formError.description ? (
                    <p className="mt-0.5 opacity-90">{formError.description}</p>
                  ) : null}
                </FormAlert>
              )}
            </div>
          ) : null}
          <FormField label="Email" error={fieldErrors.email}>
            <Input
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="login-email"
            />
          </FormField>
          <FormField
            label="Password"
            error={fieldErrors.password}
            labelAction={
              <Link
                to={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ''}`}
                className="text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Forgot password?
              </Link>
            }
          >
            <Input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="login-password"
            />
          </FormField>
          <Button
            type="submit"
            className="mt-1 w-full"
            disabled={submitting}
            data-testid="login-submit"
          >
            {submitting ? <Spinner className="text-current" label={null} /> : null}
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </AuthLayout>
  );
}

export default LoginPage;
