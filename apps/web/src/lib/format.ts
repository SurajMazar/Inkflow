const rtf =
  typeof Intl !== 'undefined' && 'RelativeTimeFormat' in Intl
    ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    : null;

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "just now", "5 minutes ago", "in 3 days"… */
export function formatRelativeTime(
  iso: string | Date | null | undefined,
  now: number = Date.now(),
): string {
  if (!iso) return '';
  const time = typeof iso === 'string' ? Date.parse(iso) : iso.getTime();
  if (!Number.isFinite(time)) return '';
  const diffSeconds = Math.round((time - now) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 45) return 'just now';
  for (const [unit, seconds] of UNITS) {
    if (abs >= seconds || unit === 'minute') {
      const value = Math.round(diffSeconds / seconds);
      return rtf
        ? rtf.format(value, unit)
        : `${Math.abs(value)} ${unit}${Math.abs(value) === 1 ? '' : 's'} ${value < 0 ? 'ago' : ''}`.trim();
    }
  }
  return '';
}

const dateTimeFormat =
  typeof Intl !== 'undefined'
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : null;
const dateFormat =
  typeof Intl !== 'undefined' ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }) : null;

/** "Sep 23, 2026, 1:40 PM" */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return dateTimeFormat ? dateTimeFormat.format(date) : date.toISOString();
}

/** "Sep 23, 2026" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return dateFormat ? dateFormat.format(date) : date.toISOString().slice(0, 10);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Human-readable role label ("OWNER" → "Owner"). */
export function formatRole(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}
