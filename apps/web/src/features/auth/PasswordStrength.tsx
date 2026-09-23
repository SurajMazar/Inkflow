import { PASSWORD_MIN_LENGTH } from '@inkflow/shared';
import { Check, Circle } from 'lucide-react';
import { cn } from '@inkflow/ui';

export interface PasswordScore {
  /** 0 (empty/too short) … 4 (strong). */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  meetsMinimum: boolean;
  hasLetterAndNumber: boolean;
}

/** Heuristic password strength used for the sign-up hint (the server enforces the real policy). */
export function scorePassword(password: string): PasswordScore {
  const meetsMinimum = password.length >= PASSWORD_MIN_LENGTH;
  const hasLetterAndNumber = /[A-Za-z]/.test(password) && /[0-9]/.test(password);
  if (!password) return { score: 0, label: '', meetsMinimum, hasLetterAndNumber };
  if (!meetsMinimum) return { score: 1, label: 'Too short', meetsMinimum, hasLetterAndNumber };
  if (!hasLetterAndNumber) return { score: 1, label: 'Weak', meetsMinimum, hasLetterAndNumber };
  const extras =
    Number(password.length >= 14) +
    Number(/[a-z]/.test(password) && /[A-Z]/.test(password)) +
    Number(/[^A-Za-z0-9]/.test(password));
  const common =
    /(password|qwerty|123456|abcdef|letmein|welcome)/i.test(password) || /(.)\1{3,}/.test(password);
  const score: PasswordScore['score'] = common ? 2 : extras >= 2 ? 4 : extras === 1 ? 3 : 2;
  const label = score === 4 ? 'Strong' : score === 3 ? 'Good' : 'Fair';
  return { score, label, meetsMinimum, hasLetterAndNumber };
}

export function PasswordStrength({ password, id }: { password: string; id?: string }) {
  const result = scorePassword(password);
  const colors = ['bg-muted', 'bg-destructive', 'bg-warning', 'bg-success', 'bg-success'];
  return (
    <div id={id} className="grid gap-2" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="grid flex-1 grid-cols-4 gap-1" aria-hidden>
          {[1, 2, 3, 4].map((segment) => (
            <div
              key={segment}
              className={cn(
                'h-1 rounded-full transition-colors',
                password && result.score >= segment ? colors[result.score] : 'bg-muted',
              )}
            />
          ))}
        </div>
        <span className="min-w-12 text-right text-xs text-muted-foreground">
          {password ? <span className="sr-only">Password strength: </span> : null}
          {password ? result.label : ''}
        </span>
      </div>
      <ul className="grid gap-1 text-xs text-muted-foreground">
        <Requirement met={result.meetsMinimum}>
          At least {PASSWORD_MIN_LENGTH} characters
        </Requirement>
        <Requirement met={result.hasLetterAndNumber}>A letter and a number</Requirement>
      </ul>
    </div>
  );
}

function Requirement({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li className={cn('flex items-center gap-1.5', met && 'text-foreground')}>
      {met ? (
        <Check className="size-3.5 text-success" aria-hidden />
      ) : (
        <Circle className="size-3 text-muted-foreground/60" aria-hidden />
      )}
      <span>
        {children}
        <span className="sr-only">{met ? ' (met)' : ' (not met)'}</span>
      </span>
    </li>
  );
}
