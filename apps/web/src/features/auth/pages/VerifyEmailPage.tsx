import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { CircleAlert } from 'lucide-react';
import { Button, FormField, Input, Spinner } from '@inkflow/ui';
import { ApiError, emailOnlySchema, type AuthResponse } from '@inkflow/shared';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/lib/use-document-title';
import { describeApiError, notify } from '@/features/notifications/notify';
import { useAuth } from '../AuthProvider';
import { AuthLayout } from '../AuthLayout';

/** Verification tokens are single-use: share one request per token (StrictMode mounts twice). */
const verifications = new Map<string, Promise<AuthResponse>>();
function verifyOnce(token: string): Promise<AuthResponse> {
  let pending = verifications.get(token);
  if (!pending) {
    pending = api.auth.verifyEmail({ token });
    verifications.set(token, pending);
  }
  return pending;
}

export function VerifyEmailPage() {
  useDocumentTitle('Verify email');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = React.useState<unknown>(token.length < 16 ? new ApiError(400, 'TOKEN_INVALID', 'Missing token') : null);

  React.useEffect(() => {
    if (token.length < 16) return;
    let active = true;
    verifyOnce(token).then(
      ({ user }) => {
        if (!active) return;
        setUser(user);
        notify.success('Email verified', { description: 'Your account is ready.' });
        navigate('/', { replace: true });
      },
      (err: unknown) => {
        if (active) setError(err);
      },
    );
    return () => {
      active = false;
    };
  }, [token, setUser, navigate]);

  if (!error) {
    return (
      <AuthLayout title="Verifying your email…">
        <div className="flex items-center gap-3 text-sm text-muted-foreground" role="status" aria-live="polite">
          <Spinner label={null} />
          Just a moment while we confirm your address.
        </div>
      </AuthLayout>
    );
  }

  const expired = error instanceof ApiError && error.code === 'TOKEN_EXPIRED';
  const { title } = describeApiError(error, "We couldn't verify your email");
  return (
    <AuthLayout
      title={expired ? 'This link has expired' : title}
      description="Request a new verification link below."
      footer={
        <Link className="font-medium text-foreground underline-offset-4 hover:underline" to="/login">
          Back to sign in
        </Link>
      }
    >
      <div className="mb-5 flex items-center gap-2 text-sm text-muted-foreground">
        <CircleAlert className="size-4 text-destructive" aria-hidden />
        Verification links can only be used once.
      </div>
      <ResendVerificationForm />
    </AuthLayout>
  );
}

function ResendVerificationForm() {
  const [email, setEmail] = React.useState('');
  const [error, setError] = React.useState<string | undefined>();
  const [state, setState] = React.useState<'idle' | 'sending' | 'sent'>('idle');
  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = emailOnlySchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    setState('sending');
    try {
      await api.auth.resendVerification(parsed.data);
      setState('sent');
    } catch (err) {
      setState('idle');
      const { title, description } = describeApiError(err, "Couldn't send the email");
      notify.error(title, { description });
    }
  };
  if (state === 'sent') {
    return (
      <p className="text-sm" role="status">
        If an unverified account exists for <span className="font-medium">{email}</span>, a new link is on its way.
      </p>
    );
  }
  return (
    <form className="grid gap-4" onSubmit={onSubmit} noValidate>
      <FormField label="Email" error={error}>
        <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </FormField>
      <Button type="submit" disabled={state === 'sending'}>
        {state === 'sending' ? <Spinner className="text-current" label={null} /> : null}
        Send new link
      </Button>
    </form>
  );
}

export default VerifyEmailPage;
