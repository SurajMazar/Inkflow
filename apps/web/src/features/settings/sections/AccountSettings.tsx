import * as React from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, Laptop, Smartphone } from 'lucide-react';
import {
  Badge,
  Button,
  FormField,
  Input,
  Skeleton,
  Spinner,
  UserAvatar,
} from '@inkflow/ui';
import { ApiError, OAUTH_PROVIDERS, changePasswordSchema, type OAuthProvider, type SessionDto } from '@inkflow/shared';
import { z } from 'zod';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatDate, formatRelativeTime } from '@/lib/format';
import { zodFieldErrors } from '@/lib/zod-errors';
import { useAuth } from '@/features/auth/AuthProvider';
import { PasswordStrength } from '@/features/auth/PasswordStrength';
import { describeApiError, notify, toastApiError } from '@/features/notifications/notify';
import { SettingsSection } from '../components';

export function AccountSettings() {
  return (
    <div className="grid gap-8">
      <ProfileSection />
      <PasswordSection />
      <ProvidersSection />
      <SessionsSection />
    </div>
  );
}

const profileSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  avatarUrl: z.union([z.literal(''), z.url('Enter a valid URL (https://…)').max(2048)]),
});

function ProfileSection() {
  const { user, updateMe } = useAuth();
  const [name, setName] = React.useState(user?.name ?? '');
  const [avatarUrl, setAvatarUrl] = React.useState(user?.avatarUrl ?? '');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [resending, setResending] = React.useState(false);

  React.useEffect(() => {
    setName(user?.name ?? '');
    setAvatarUrl(user?.avatarUrl ?? '');
  }, [user?.name, user?.avatarUrl]);

  if (!user) return null;
  const dirty = name.trim() !== user.name || (avatarUrl.trim() || null) !== user.avatarUrl;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = profileSchema.safeParse({ name, avatarUrl: avatarUrl.trim() });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await updateMe({ name: parsed.data.name, avatarUrl: parsed.data.avatarUrl || null });
      notify.success('Profile updated');
    } catch (error) {
      toastApiError(error, "Couldn't update your profile");
    } finally {
      setSaving(false);
    }
  };

  const resend = async () => {
    setResending(true);
    try {
      await api.auth.resendVerification({ email: user.email });
      notify.success('Verification email sent', { description: user.email });
    } catch (error) {
      toastApiError(error, "Couldn't send the email");
    } finally {
      setResending(false);
    }
  };

  return (
    <SettingsSection title="Profile" description="How you appear to collaborators.">
      <form className="grid gap-5 p-4" onSubmit={submit} noValidate>
        <div className="flex items-center gap-4">
          <UserAvatar name={name || user.name} src={avatarUrl || null} className="size-14 text-base" />
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium">{name || user.name}</p>
            <p className="text-muted-foreground">Member since {formatDate(user.createdAt)}</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" error={errors.name}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" data-testid="account-name" />
          </FormField>
          <FormField label="Avatar URL" error={errors.avatarUrl} description="Link to a square image. Leave empty to use your initials.">
            <Input
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://…"
              inputMode="url"
              data-testid="account-avatar"
            />
          </FormField>
        </div>
        <FormField
          label="Email"
          description={
            user.emailVerified ? (
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="size-3.5 text-success" aria-hidden /> Verified
              </span>
            ) : (
              <span className="inline-flex flex-wrap items-center gap-1">
                <CircleAlert className="size-3.5 text-warning" aria-hidden /> Not verified.
                <button type="button" onClick={() => void resend()} disabled={resending} className="font-medium text-foreground underline underline-offset-4">
                  {resending ? 'Sending…' : 'Resend verification email'}
                </button>
              </span>
            )
          }
        >
          <Input value={user.email} readOnly disabled className="bg-muted/40" />
        </FormField>
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!dirty || saving} data-testid="account-save">
            {saving ? <Spinner className="text-current" label={null} /> : null}
            Save profile
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}

function PasswordSection() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const change = useMutation({
    mutationFn: () => api.auth.changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.sessions });
      notify.success('Password changed', { description: 'Other sessions were signed out.' });
    },
    onError: (error) => {
      if (error instanceof ApiError && (error.code === 'INVALID_CREDENTIALS' || error.status === 401 || error.status === 403)) {
        setErrors({ currentPassword: 'Current password is incorrect' });
      } else {
        const { title, description } = describeApiError(error, "Couldn't change your password");
        notify.error(title, { description });
      }
    },
  });

  if (!user?.hasPassword) {
    return (
      <SettingsSection title="Password">
        <p className="p-4 text-sm text-muted-foreground">
          You sign in with {user?.oauthProviders.map(providerLabel).join(' or ') || 'a connected account'}. To add a password, use{' '}
          <Link to={`/forgot-password?email=${encodeURIComponent(user?.email ?? '')}`} className="font-medium text-foreground underline underline-offset-4">
            reset password
          </Link>{' '}
          with your email.
        </p>
      </SettingsSection>
    );
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = changePasswordSchema.safeParse({ currentPassword, newPassword });
    const next = parsed.success ? {} : zodFieldErrors(parsed.error);
    if (confirm !== newPassword) next.confirm = "Passwords don't match";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    change.mutate();
  };

  return (
    <SettingsSection title="Password" description="Changing your password signs you out everywhere else.">
      <form className="grid gap-4 p-4" onSubmit={submit} noValidate>
        <FormField label="Current password" error={errors.currentPassword}>
          <Input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} data-testid="password-current" />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="New password" error={errors.newPassword}>
            {(props) => (
              <>
                <Input {...props} type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} data-testid="password-new" />
                {newPassword ? <PasswordStrength password={newPassword} /> : null}
              </>
            )}
          </FormField>
          <FormField label="Confirm new password" error={errors.confirm}>
            <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="password-confirm" />
          </FormField>
        </div>
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={change.isPending || !currentPassword || !newPassword} data-testid="password-submit">
            {change.isPending ? <Spinner className="text-current" label={null} /> : null}
            Change password
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}

function providerLabel(provider: OAuthProvider): string {
  return provider === 'google' ? 'Google' : 'GitHub';
}

function ProvidersSection() {
  const { user } = useAuth();
  const providers = useQuery({
    queryKey: queryKeys.auth.providers,
    queryFn: ({ signal }) => api.auth.providers({ signal }),
    staleTime: 10 * 60_000,
  });
  if (!user) return null;
  const available = OAUTH_PROVIDERS.filter((p) => providers.data?.[p] || user.oauthProviders.includes(p));
  if (providers.isSuccess && available.length === 0) return null;
  return (
    <SettingsSection title="Connected accounts" description="Sign in faster with an external provider.">
      {providers.isPending ? (
        <div className="p-4">
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <ul className="divide-y">
          {available.map((provider) => {
            const connected = user.oauthProviders.includes(provider);
            return (
              <li key={provider} className="flex items-center justify-between gap-3 px-4 py-3" data-testid={`provider-${provider}`}>
                <div>
                  <p className="text-sm font-medium">{providerLabel(provider)}</p>
                  <p className="text-[13px] text-muted-foreground">{connected ? 'Connected' : 'Not connected'}</p>
                </div>
                {connected ? (
                  <Badge variant="subtle">Connected</Badge>
                ) : providers.data?.[provider] ? (
                  <Button asChild variant="outline" size="sm">
                    <a href={api.auth.oauthUrl(provider, '/settings/account')}>Connect</a>
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </SettingsSection>
  );
}

function describeDevice(userAgent: string | null): { label: string; mobile: boolean } {
  if (!userAgent) return { label: 'Unknown device', mobile: false };
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Browser';
  const os = /iPhone|iPad/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Mac OS X/.test(userAgent)
        ? 'macOS'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : '';
  return { label: os ? `${browser} on ${os}` : browser, mobile: /Mobile|iPhone|Android/.test(userAgent) };
}

function SessionsSection() {
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: queryKeys.auth.sessions,
    queryFn: ({ signal }) => api.auth.sessions({ signal }),
  });
  const revoke = useMutation({
    mutationFn: (session: SessionDto) => api.auth.revokeSession(session.id),
    onSuccess: (_ok, session) => {
      queryClient.setQueryData<SessionDto[]>(queryKeys.auth.sessions, (list) => list?.filter((s) => s.id !== session.id));
      notify.success('Session signed out');
    },
    onError: (error) => toastApiError(error, "Couldn't revoke the session"),
  });
  const list = [...(sessions.data ?? [])].sort(
    (a, b) => Number(b.current) - Number(a.current) || Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt),
  );
  return (
    <SettingsSection title="Active sessions" description="Devices where you're signed in.">
      {sessions.isPending ? (
        <div className="grid gap-2 p-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : sessions.isError ? (
        <p className="p-4 text-sm text-muted-foreground">Couldn't load sessions.</p>
      ) : (
        <ul className="divide-y" data-testid="sessions-list">
          {list.map((session) => {
            const device = describeDevice(session.userAgent);
            const Icon = device.mobile ? Smartphone : Laptop;
            return (
              <li key={session.id} className="flex items-center gap-3 px-4 py-3" data-testid="session-item">
                <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <span className="truncate">{device.label}</span>
                    {session.current ? <Badge variant="subtle">This device</Badge> : null}
                  </p>
                  <p className="truncate text-[13px] text-muted-foreground">
                    {session.ip ? `${session.ip} · ` : ''}Last active {formatRelativeTime(session.lastUsedAt)}
                  </p>
                </div>
                {!session.current ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(session)}
                    data-testid="session-revoke"
                  >
                    Sign out
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </SettingsSection>
  );
}
