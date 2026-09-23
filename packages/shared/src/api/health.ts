export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthCheckDto {
  status: HealthStatus;
  uptimeSeconds: number;
  version: string;
  checks: Record<string, { status: HealthStatus; latencyMs?: number; error?: string }>;
}
