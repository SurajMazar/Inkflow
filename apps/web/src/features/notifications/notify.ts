import { toast, type ExternalToast } from '@inkflow/ui';
import { ApiError } from '@inkflow/shared';
import { retryAfterSeconds } from '@/lib/api';

export interface ErrorDescription {
  title: string;
  /** Secondary sentence ('' when there is nothing to add). */
  description: string;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function firstValidationIssue(details: unknown): string | null {
  const issues = Array.isArray(details)
    ? details
    : details && typeof details === 'object' && Array.isArray((details as { issues?: unknown }).issues)
      ? (details as { issues: unknown[] }).issues
      : null;
  if (!issues) return null;
  for (const issue of issues) {
    if (issue && typeof issue === 'object' && typeof (issue as { message?: unknown }).message === 'string') {
      const path = (issue as { path?: unknown }).path;
      const field = Array.isArray(path) && path.length > 0 ? String(path[path.length - 1]) : null;
      const message = (issue as { message: string }).message;
      return field && !message.toLowerCase().includes(field.toLowerCase()) ? `${field}: ${message}` : message;
    }
  }
  return null;
}

/**
 * Maps any thrown value (usually an `ApiError`) to a short, human-friendly message.
 * `fallback` is used as the title for unexpected errors.
 */
export function describeApiError(error: unknown, fallback = 'Something went wrong'): ErrorDescription {
  const { title, description } = describe(error, fallback);
  return { title, description: description ?? '' };
}

function describe(error: unknown, fallback: string): { title: string; description?: string } {
  if (!(error instanceof ApiError)) {
    if (error instanceof Error && error.message && !/fetch|network/i.test(error.message)) {
      return { title: fallback, description: error.message };
    }
    return { title: fallback };
  }
  switch (error.code) {
    case 'SERVICE_UNAVAILABLE':
      return {
        title: "Can't reach Inkflow",
        description: 'Check your internet connection and try again.',
      };
    case 'UNAUTHORIZED':
    case 'SESSION_EXPIRED':
      return { title: 'Your session has expired', description: 'Please sign in again to continue.' };
    case 'FORBIDDEN':
      return { title: "You don't have permission to do that", description: 'Ask an owner for access.' };
    case 'NOT_FOUND':
      return {
        title: "We couldn't find that",
        description: 'It may have been deleted, or you no longer have access.',
      };
    case 'RATE_LIMITED': {
      const seconds = retryAfterSeconds(error);
      return {
        title: 'Slow down a little',
        description: seconds ? `Too many requests — try again in ${seconds}s.` : 'Too many requests — try again shortly.',
      };
    }
    case 'VALIDATION_FAILED':
      return {
        title: 'Please check the highlighted fields',
        description: firstValidationIssue(error.details) ?? error.message,
      };
    case 'PAYLOAD_TOO_LARGE':
      return { title: 'That file is too large', description: error.message };
    case 'UNSUPPORTED_MEDIA_TYPE':
      return { title: "That file type isn't supported", description: error.message };
    case 'CSRF_INVALID':
      return { title: 'Security check failed', description: 'Reload the page and try again.' };
    case 'EMAIL_NOT_VERIFIED':
      return { title: 'Verify your email first', description: 'Check your inbox for the verification link.' };
    case 'INVALID_CREDENTIALS':
      return { title: 'Incorrect email or password' };
    case 'TOKEN_INVALID':
      return { title: 'This link is invalid', description: 'Request a new one and try again.' };
    case 'TOKEN_EXPIRED':
      return { title: 'This link has expired', description: 'Request a new one and try again.' };
    case 'OAUTH_FAILED':
      return { title: "Couldn't sign in with that provider", description: error.message };
    case 'CONFLICT':
      return { title: error.message || 'That conflicts with an existing item' };
    case 'INTERNAL':
    default:
      return { title: 'Something went wrong on our side', description: 'Please try again in a moment.' };
  }
}

/** Drops empty descriptions so toasts don't render a blank second line. */
function clean(options?: ExternalToast): ExternalToast | undefined {
  if (!options || options.description !== '') return options;
  return { ...options, description: undefined };
}

/** Toast helpers (sonner) styled by the app `<Toaster />`. */
export const notify = {
  success: (message: string, options?: ExternalToast) => toast.success(message, clean(options)),
  error: (message: string, options?: ExternalToast) => toast.error(message, clean(options)),
  info: (message: string, options?: ExternalToast) => toast.info(message, clean(options)),
  warning: (message: string, options?: ExternalToast) => toast.warning(message, clean(options)),
  message: (message: string, options?: ExternalToast) => toast(message, clean(options)),
  dismiss: (id?: string | number) => toast.dismiss(id),
};

/**
 * Shows an error toast for a failed request. Aborted requests are ignored. Identical
 * connectivity/permission errors are de-duplicated by code.
 */
export function toastApiError(error: unknown, fallback?: string): void {
  if (isAbort(error)) return;
  const { title, description } = describeApiError(error, fallback);
  const id = error instanceof ApiError ? `api-error-${error.code}-${title}` : undefined;
  toast.error(title, { description: description || undefined, id });
}
