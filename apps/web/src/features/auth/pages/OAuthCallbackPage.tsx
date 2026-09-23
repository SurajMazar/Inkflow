import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button } from '@inkflow/ui';
import { FullPageLoader, FullPageMessage } from '@/components/FullPageState';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useAuth } from '../AuthProvider';
import { sanitizeNext } from '../next-param';

const OAUTH_MESSAGES: Record<string, string> = {
  OAUTH_FAILED: 'The provider did not complete the sign-in. Please try again.',
  CONFLICT:
    'An account with this email already exists. Sign in with your password, then connect the provider in Settings.',
  EMAIL_NOT_VERIFIED: 'Your provider account has no verified email address.',
  FORBIDDEN: 'Sign-in with this provider is not allowed for your account.',
  access_denied: 'You cancelled the sign-in.',
};

/** Landing page of `/auth/oauth/:provider/callback` → `/auth/callback?status=&code=&next=`. */
export function OAuthCallbackPage() {
  useDocumentTitle('Signing in');
  const [params] = useSearchParams();
  const status = params.get('status');
  const code = params.get('code') ?? '';
  const next = sanitizeNext(params.get('next'));
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const [failed, setFailed] = React.useState(status !== 'success');

  React.useEffect(() => {
    if (status !== 'success') return;
    let active = true;
    refreshUser().then(
      (user) => {
        if (!active) return;
        if (user) navigate(next, { replace: true });
        else setFailed(true);
      },
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, [status, next, refreshUser, navigate]);

  if (!failed) return <FullPageLoader label="Signing you in…" />;

  return (
    <FullPageMessage
      title="We couldn't sign you in"
      description={
        OAUTH_MESSAGES[code] ??
        'Something went wrong while signing in with the provider. Please try again.'
      }
      actions={
        <Button asChild>
          <Link to={next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login'}>
            Back to sign in
          </Link>
        </Button>
      }
    />
  );
}

export default OAuthCallbackPage;
