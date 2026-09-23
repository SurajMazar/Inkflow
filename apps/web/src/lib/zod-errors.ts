import type { z } from 'zod';

/** Converts Zod issues to `{ field: firstMessage }` (top-level path segment). */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : '_form';
    if (!(key in errors)) errors[key] = issue.message;
  }
  return errors;
}

/** Maps server `VALIDATION_FAILED` details (Zod issues) to field errors when possible. */
export function serverFieldErrors(details: unknown): Record<string, string> {
  const issues = Array.isArray(details)
    ? details
    : details && typeof details === 'object' && Array.isArray((details as { issues?: unknown }).issues)
      ? (details as { issues: unknown[] }).issues
      : [];
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    if (!issue || typeof issue !== 'object') continue;
    const { path, message } = issue as { path?: unknown; message?: unknown };
    if (typeof message !== 'string') continue;
    const key = Array.isArray(path) && path.length > 0 ? String(path[0]) : '_form';
    if (!(key in errors)) errors[key] = message;
  }
  return errors;
}
