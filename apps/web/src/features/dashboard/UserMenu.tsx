import { useNavigate } from 'react-router';
import { Keyboard, LogOut, Monitor, Moon, Settings, Sun, SunMoon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  UserAvatar,
} from '@inkflow/ui';
import type { ThemePreference } from '@inkflow/shared';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTheme } from '@/features/theme/ThemeProvider';

/** Avatar menu: account settings, theme, sign out. */
export function UserMenu() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 pointer-coarse:p-1"
          aria-label={`Account menu for ${user.name}`}
          data-testid="user-menu"
        >
          <UserAvatar name={user.name} src={user.avatarUrl} className="size-8" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="grid gap-0.5 py-2 font-normal">
          <span className="truncate text-sm font-medium text-foreground">{user.name}</span>
          <span className="truncate text-xs">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => navigate('/settings/account')}
          data-testid="user-menu-settings"
        >
          <Settings aria-hidden />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/settings/shortcuts')}>
          <Keyboard aria-hidden />
          Keyboard shortcuts
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-testid="user-menu-theme">
            <SunMoon aria-hidden />
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(value) => setTheme(value as ThemePreference)}
            >
              <DropdownMenuRadioItem value="light" data-testid="theme-light">
                <Sun className="size-4 text-muted-foreground" aria-hidden />
                Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark" data-testid="theme-dark">
                <Moon className="size-4 text-muted-foreground" aria-hidden />
                Dark
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system" data-testid="theme-system">
                <Monitor className="size-4 text-muted-foreground" aria-hidden />
                System
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void logout().then(() => navigate('/login', { replace: true }));
          }}
          data-testid="logout"
        >
          <LogOut aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
