export const NOTIFICATIONS_TAB_IDS = ['feed', 'broadcast', 'automations', 'log'] as const;
export type NotificationsTabId = (typeof NOTIFICATIONS_TAB_IDS)[number];

export function resolveNotificationsTab(
  requested: string | null,
  canPushAdmin: boolean,
): NotificationsTabId {
  const r = requested ?? 'feed';
  if (!NOTIFICATIONS_TAB_IDS.includes(r as NotificationsTabId)) {
    return 'feed';
  }
  if ((r === 'broadcast' || r === 'automations' || r === 'log') && !canPushAdmin) {
    return 'feed';
  }
  return r as NotificationsTabId;
}
