import { Logo } from '@/components/Logo';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useAuth } from '@/features/auth/AuthProvider';
import { CreateWorkspaceForm } from '@/features/workspaces/CreateWorkspaceDialog';
import { UserMenu } from './UserMenu';

/** First run: the user has no workspace yet. */
export function OnboardingPage() {
  useDocumentTitle('Welcome');
  const { user } = useAuth();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 items-center justify-between px-6">
        <Logo />
        <UserMenu />
      </header>
      <main
        id="main-content"
        className="flex flex-1 items-start justify-center px-4 pt-[8vh] pb-16"
        data-testid="onboarding"
      >
        <div className="w-full max-w-md">
          <p className="font-hand text-lg text-primary">
            Welcome{user ? `, ${user.name.split(' ')[0]}` : ''}!
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Create your workspace</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A workspace is home for your team's boards. You can invite people and create more
            workspaces later.
          </p>
          <div className="mt-8 rounded-2xl border bg-card p-6">
            <CreateWorkspaceForm submitLabel="Create workspace" />
          </div>
        </div>
      </main>
    </div>
  );
}
