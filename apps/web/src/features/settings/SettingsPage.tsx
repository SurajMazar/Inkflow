import * as React from 'react';
import { Link, NavLink, Navigate, useParams } from 'react-router';
import { ArrowLeft, Bell, Brush, Building2, Keyboard, MousePointer2, Palette, UserRound } from 'lucide-react';
import { cn } from '@inkflow/ui';
import { Logo } from '@/components/Logo';
import { RouteFallback } from '@/app/RouteFallback';
import { useDocumentTitle } from '@/lib/use-document-title';
import { getLastWorkspaceId } from '@/features/workspaces/last-workspace';
import { UserMenu } from '@/features/dashboard/UserMenu';
import { AccountSettings } from './sections/AccountSettings';
import { AppearanceSettings } from './sections/AppearanceSettings';
import { CanvasSettings } from './sections/CanvasSettings';
import { NotificationSettings } from './sections/NotificationSettings';
import { StyleSettings } from './sections/StyleSettings';
import { WorkspaceSettingsLinks } from './sections/WorkspaceSettingsLinks';

// The shortcuts editor pulls in the editor engine's shortcut catalog; load it on demand.
const ShortcutSettings = React.lazy(async () => ({
  default: (await import('./sections/ShortcutSettings')).ShortcutSettings,
}));

export const SETTINGS_SECTIONS = [
  { id: 'account', label: 'Account', icon: UserRound, description: 'Profile, password and sessions.', component: AccountSettings },
  { id: 'appearance', label: 'Appearance', icon: Palette, description: 'Theme and accessibility.', component: AppearanceSettings },
  { id: 'canvas', label: 'Canvas', icon: MousePointer2, description: 'Grid, snapping and input.', component: CanvasSettings },
  { id: 'styles', label: 'Default styles', icon: Brush, description: 'Starting styles for new shapes.', component: StyleSettings },
  { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard, description: 'Customize editor shortcuts.', component: ShortcutSettings },
  { id: 'notifications', label: 'Notifications', icon: Bell, description: 'What we notify you about.', component: NotificationSettings },
  { id: 'workspace', label: 'Workspace', icon: Building2, description: 'Members and workspace settings.', component: WorkspaceSettingsLinks },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

/** `/settings/:section?` — personal settings. */
export function SettingsPage() {
  const { section } = useParams();
  const active = SETTINGS_SECTIONS.find((s) => s.id === section);
  useDocumentTitle(active ? `${active.label} settings` : 'Settings');
  const lastWorkspace = getLastWorkspaceId();
  const backTo = lastWorkspace ? `/w/${lastWorkspace}` : '/';

  if (!active) return <Navigate to="/settings/account" replace />;
  const Section = active.component;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur sm:px-6">
        <Link
          to={backTo}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground pointer-coarse:min-h-10"
          data-testid="settings-back"
          aria-label="Back to boards"
        >
          <ArrowLeft className="size-4" aria-hidden />
          <span className="hidden sm:inline" aria-hidden>
            Back to boards
          </span>
        </Link>
        <Link to={backTo} className="hidden sm:block" aria-hidden tabIndex={-1}>
          <Logo />
        </Link>
        <div className="ml-auto">
          <UserMenu />
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 md:flex-row md:gap-10 md:py-10">
        <nav aria-label="Settings" className="md:w-56 md:shrink-0">
          <h1 className="mb-3 hidden px-2 text-lg font-semibold tracking-tight md:block">Settings</h1>
          <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:overflow-visible md:px-0">
            {SETTINGS_SECTIONS.map((item) => (
              <li key={item.id} className="shrink-0">
                <NavLink
                  to={`/settings/${item.id}`}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 pointer-coarse:min-h-10',
                      isActive && 'bg-accent font-medium text-foreground',
                    )
                  }
                  data-testid={`settings-nav-${item.id}`}
                >
                  <item.icon className="size-4" aria-hidden />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main id="main-content" className="min-w-0 flex-1 pb-[env(safe-area-inset-bottom)]" tabIndex={-1}>
          <div className="mb-6">
            <h2 className="text-xl font-semibold tracking-tight">{active.label}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{active.description}</p>
          </div>
          <React.Suspense fallback={<RouteFallback />}>
            <Section />
          </React.Suspense>
        </main>
      </div>
    </div>
  );
}

export default SettingsPage;
