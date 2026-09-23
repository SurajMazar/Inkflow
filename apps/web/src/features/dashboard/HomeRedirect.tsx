import { Navigate } from 'react-router';
import { Button } from '@inkflow/ui';
import { FullPageLoader, FullPageMessage } from '@/components/FullPageState';
import { describeApiError } from '@/features/notifications/notify';
import { useWorkspaces } from '@/features/workspaces/hooks';
import { getLastWorkspaceId } from '@/features/workspaces/last-workspace';
import { OnboardingPage } from './OnboardingPage';

/** `/` — opens the last used workspace, or onboarding when the user has none. */
export function HomeRedirect() {
  const workspaces = useWorkspaces();
  if (workspaces.isPending) return <FullPageLoader />;
  if (workspaces.isError) {
    const { title, description } = describeApiError(
      workspaces.error,
      "Couldn't load your workspaces",
    );
    return (
      <FullPageMessage
        title={title}
        description={description}
        actions={<Button onClick={() => void workspaces.refetch()}>Try again</Button>}
      />
    );
  }
  const list = workspaces.data;
  if (list.length === 0) return <OnboardingPage />;
  const last = getLastWorkspaceId();
  const target = list.find((w) => w.id === last) ?? list[0]!;
  return <Navigate to={`/w/${target.id}`} replace />;
}

export default HomeRedirect;
