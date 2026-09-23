import { Monitor, Moon, Sun } from 'lucide-react';
import { RadioGroup, RadioGroupItem, cn } from '@inkflow/ui';
import type { ThemePreference } from '@inkflow/shared';
import { useTheme } from '@/features/theme/ThemeProvider';
import { SettingsSection, SwitchRow, useSavePreferences } from '../components';

const THEMES: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function AppearanceSettings() {
  const { preferences, save } = useSavePreferences();
  const { resolvedTheme } = useTheme();
  return (
    <div className="grid gap-8">
      <SettingsSection title="Theme" description={`Currently showing the ${resolvedTheme} theme.`}>
        <RadioGroup
          value={preferences.theme}
          onValueChange={(value) => void save({ theme: value as ThemePreference }, 'Theme updated')}
          className="grid grid-cols-3 gap-3 p-4"
          aria-label="Theme"
        >
          {THEMES.map(({ value, label, icon: Icon }) => {
            const selected = preferences.theme === value;
            return (
              <label
                key={value}
                htmlFor={`theme-${value}`}
                className={cn(
                  'flex cursor-pointer flex-col items-center gap-2 rounded-lg border p-3 text-sm transition-colors hover:bg-accent/60 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40',
                  selected && 'border-primary/60 bg-brand-subtle/50 font-medium',
                )}
                data-testid={`appearance-theme-${value}`}
              >
                <ThemePreview variant={value} />
                <span className="flex items-center gap-1.5">
                  <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                  {label}
                </span>
                <RadioGroupItem
                  id={`theme-${value}`}
                  value={value}
                  aria-label={`${label} theme`}
                  className="sr-only"
                />
              </label>
            );
          })}
        </RadioGroup>
      </SettingsSection>
      <SettingsSection title="Accessibility">
        <SwitchRow
          label="High contrast"
          description="Stronger borders, text and focus rings throughout the interface."
          checked={preferences.highContrast}
          onCheckedChange={(highContrast) => void save({ highContrast })}
          testId="appearance-high-contrast"
        />
        <SwitchRow
          label="Reduce motion"
          description="Minimize animations and transitions. Your system setting is always respected."
          checked={preferences.reduceMotion}
          onCheckedChange={(reduceMotion) => void save({ reduceMotion })}
          testId="appearance-reduce-motion"
        />
      </SettingsSection>
    </div>
  );
}

function ThemePreview({ variant }: { variant: ThemePreference }) {
  const light = (
    <div className="flex h-full flex-col gap-1 bg-white p-1.5">
      <div className="h-1.5 w-8 rounded-full bg-zinc-300" />
      <div className="h-1.5 w-12 rounded-full bg-zinc-200" />
      <div className="mt-auto h-3 w-6 rounded-sm bg-indigo-500" />
    </div>
  );
  const dark = (
    <div className="flex h-full flex-col gap-1 bg-zinc-900 p-1.5">
      <div className="h-1.5 w-8 rounded-full bg-zinc-600" />
      <div className="h-1.5 w-12 rounded-full bg-zinc-700" />
      <div className="mt-auto h-3 w-6 rounded-sm bg-indigo-400" />
    </div>
  );
  return (
    <div aria-hidden className="h-14 w-full overflow-hidden rounded-md border">
      {variant === 'light' ? (
        light
      ) : variant === 'dark' ? (
        dark
      ) : (
        <div className="grid h-full grid-cols-2">
          {light}
          {dark}
        </div>
      )}
    </div>
  );
}
