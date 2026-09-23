import * as React from 'react';
import { useNavigate } from 'react-router';
import { Bell, CheckCheck } from 'lucide-react';
import {
  Button,
  EmptyState,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Skeleton,
  UserAvatar,
  cn,
} from '@inkflow/ui';
import type { NotificationDto } from '@inkflow/shared';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { useNotifications } from './useNotifications';

/** Bell button with unread badge and a popover listing recent notifications. */
export function NotificationsBell() {
  const { notifications, unreadCount, isLoading, isError, refetch, markRead, markAllRead } =
    useNotifications();
  const [open, setOpen] = React.useState(false);
  const navigate = useNavigate();

  const onSelect = (notification: NotificationDto) => {
    if (!notification.readAt) markRead(notification.id);
    setOpen(false);
    if (notification.link) navigate(notification.link);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-muted-foreground"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
          data-testid="notifications-bell"
        >
          <Bell aria-hidden />
          {unreadCount > 0 ? (
            <span
              className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground ring-2 ring-background"
              aria-hidden
              data-testid="notifications-unread"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(380px,calc(100vw-1rem))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">Notifications</h2>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-muted-foreground"
            disabled={unreadCount === 0}
            onClick={() => markAllRead()}
            data-testid="notifications-read-all"
          >
            <CheckCheck aria-hidden />
            Mark all as read
          </Button>
        </div>
        <ScrollArea
          className="max-h-[min(420px,60dvh)]"
          viewportClassName="max-h-[min(420px,60dvh)]"
        >
          {isLoading ? (
            <div className="grid gap-3 p-4" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="size-8 rounded-full" />
                  <div className="grid flex-1 gap-1.5">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : isError && notifications.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground" role="alert">
              Couldn't load notifications.{' '}
              <button
                type="button"
                className="font-medium text-foreground underline underline-offset-4"
                onClick={() => void refetch()}
              >
                Retry
              </button>
            </div>
          ) : notifications.length === 0 ? (
            <EmptyState
              size="sm"
              className="m-4 border-0"
              icon={<Bell />}
              title="You're all caught up"
              description="Mentions, shares and comments show up here."
            />
          ) : (
            <ul className="grid p-1" aria-label="Notifications" data-testid="notifications-list">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(notification)}
                    className={cn(
                      'flex w-full gap-3 rounded-md px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent',
                      !notification.readAt && 'bg-brand-subtle/40',
                    )}
                    data-testid="notification-item"
                  >
                    {notification.actor ? (
                      <UserAvatar
                        name={notification.actor.name}
                        src={notification.actor.avatarUrl}
                        className="size-8"
                      />
                    ) : (
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <Bell className="size-4" aria-hidden />
                      </span>
                    )}
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 text-sm font-medium">
                          {notification.title}
                        </span>
                        {!notification.readAt ? (
                          <span
                            className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                            aria-label="Unread"
                          />
                        ) : null}
                      </span>
                      {notification.body ? (
                        <span className="line-clamp-2 text-[13px] text-muted-foreground">
                          {notification.body}
                        </span>
                      ) : null}
                      <time
                        dateTime={notification.createdAt}
                        title={formatDateTime(notification.createdAt)}
                        className="text-xs text-muted-foreground"
                      >
                        {formatRelativeTime(notification.createdAt)}
                      </time>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
