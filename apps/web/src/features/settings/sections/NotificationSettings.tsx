import { SettingsSection, SwitchRow, useSavePreferences } from '../components';

export function NotificationSettings() {
  const { preferences, save } = useSavePreferences();
  const n = preferences.notifications;
  return (
    <div className="grid gap-8">
      <SettingsSection title="Email" description="In-app notifications are always available from the bell.">
        <SwitchRow
          label="Email notifications"
          description="Receive a copy of important notifications by email."
          checked={n.email}
          onCheckedChange={(email) => void save({ notifications: { email } })}
          testId="notify-email"
        />
      </SettingsSection>
      <SettingsSection title="Notify me about">
        <SwitchRow
          label="Mentions"
          description="Someone @mentions you in a comment."
          checked={n.mentions}
          onCheckedChange={(mentions) => void save({ notifications: { mentions } })}
          testId="notify-mentions"
        />
        <SwitchRow
          label="Shares & invitations"
          description="A board or workspace is shared with you."
          checked={n.shares}
          onCheckedChange={(shares) => void save({ notifications: { shares } })}
          testId="notify-shares"
        />
        <SwitchRow
          label="Comments"
          description="New comments and replies on boards you own or follow."
          checked={n.comments}
          onCheckedChange={(comments) => void save({ notifications: { comments } })}
          testId="notify-comments"
        />
      </SettingsSection>
    </div>
  );
}
