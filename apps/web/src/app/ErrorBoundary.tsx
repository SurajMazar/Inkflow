import * as React from 'react';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router';
import { Button } from '@inkflow/ui';
import { FullPageMessage } from '@/components/FullPageState';

function isChunkLoadError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
      error.message,
    )
  );
}

function ErrorFallback({ error, onReset }: { error: unknown; onReset?: () => void }) {
  const chunk = isChunkLoadError(error);
  return (
    <FullPageMessage
      title={chunk ? 'A new version of Inkflow is available' : 'Something went wrong'}
      description={
        chunk
          ? 'Reload the page to get the latest version.'
          : 'An unexpected error occurred. Your boards are safe — try reloading, or head back home.'
      }
      actions={
        <>
          <Button onClick={() => window.location.reload()}>Reload page</Button>
          {!chunk ? (
            <Button
              variant="outline"
              onClick={() => {
                onReset?.();
                window.location.assign('/');
              }}
            >
              Go home
            </Button>
          ) : null}
        </>
      }
    />
  );
}

interface ErrorBoundaryState {
  error: unknown;
}

/** Top-level boundary for errors thrown outside the router (providers, layout). */
export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('[inkflow] unhandled render error', error, info.componentStack);
  }

  override render() {
    if (this.state.error) return <ErrorFallback error={this.state.error} onReset={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}

/** `errorElement` for routes: 404 responses and render/loader errors. */
export function RouteErrorPage() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  console.error('[inkflow] route error', error);
  return <ErrorFallback error={error} />;
}

export function NotFoundPage() {
  return (
    <FullPageMessage
      title="Page not found"
      description="The page you're looking for doesn't exist or has moved."
      actions={
        <Button asChild>
          <Link to="/">Back to Inkflow</Link>
        </Button>
      }
    />
  );
}
