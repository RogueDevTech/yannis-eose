import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, getCurrentUser, safeStatus } from '~/lib/api.server';
import { SettingsPage } from '~/features/settings/SettingsPage';

export const meta: MetaFunction = () => [
  { title: 'Settings — Yannis EOSE' },
];

interface SystemSetting {
  key: string;
  value: Record<string, unknown>;
  updatedBy: string | null;
  updatedAt: string;
}

interface NotificationTypeConfig {
  type: string;
  label: string;
  description: string;
  mandatory: boolean;
  category: string;
  emailEnabled: boolean;
}

interface NotificationEmailConfig {
  configurable: NotificationTypeConfig[];
  mandatory: NotificationTypeConfig[];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  const cookie = getSessionCookie(request);

  // Fetch system settings
  let systemSettings: SystemSetting[] = [];
  const settingsRes = await apiRequest<unknown>(
    '/trpc/settings.getSystemSettings',
    { method: 'GET', cookie },
  );
  if (settingsRes.ok) {
    const data = settingsRes.data as { result?: { data?: SystemSetting[] } };
    systemSettings = data?.result?.data ?? [];
  }

  // Fetch notification email config (SuperAdmin only)
  let notificationEmailConfig: NotificationEmailConfig | null = null;
  if (user?.role === 'SUPER_ADMIN') {
    const configRes = await apiRequest<unknown>(
      '/trpc/settings.getNotificationEmailConfig',
      { method: 'GET', cookie },
    );
    if (configRes.ok) {
      const data = configRes.data as { result?: { data?: NotificationEmailConfig } };
      notificationEmailConfig = data?.result?.data ?? null;
    }
  }

  return { user, systemSettings, notificationEmailConfig };
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'updateProfile') {
    const res = await apiRequest<unknown>('/trpc/users.updateProfile', {
      method: 'POST',
      cookie,
      body: {
        name: formData.get('name')?.toString() ?? '',
      },
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to update profile' }, { status: safeStatus(res.status) });
    }
    return json({ success: true, message: 'Profile updated' });
  }

  if (intent === 'changePassword') {
    const currentPassword = formData.get('currentPassword')?.toString() ?? '';
    const newPassword = formData.get('newPassword')?.toString() ?? '';
    const confirmPassword = formData.get('confirmPassword')?.toString() ?? '';

    if (newPassword !== confirmPassword) {
      return json({ error: 'New passwords do not match' }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/users.changePassword', {
      method: 'POST',
      cookie,
      body: { currentPassword, newPassword },
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to change password' }, { status: safeStatus(res.status) });
    }
    return json({ success: true, message: 'Password changed' });
  }

  if (intent === 'updateSystemSettings') {
    const voipEnabled = formData.get('voipEnabled')?.toString() === 'true';
    const csDispatchStrategy = formData.get('csDispatchStrategy')?.toString() ?? 'load_balanced';
    if (csDispatchStrategy !== 'load_balanced' && csDispatchStrategy !== 'performance') {
      return json({ error: 'Invalid CS dispatch strategy' }, { status: 400 });
    }

    // 1. VOIP (dedicated procedure)
    const voipRes = await apiRequest<unknown>('/trpc/voip.setEnabled', {
      method: 'POST',
      cookie,
      body: { enabled: voipEnabled },
    });
    if (!voipRes.ok) {
      const errorData = voipRes.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to update VOIP setting' }, { status: safeStatus(voipRes.status) });
    }

    // 2. CS dispatch strategy
    const csRes = await apiRequest<unknown>('/trpc/settings.updateSystemSetting', {
      method: 'POST',
      cookie,
      body: { key: 'CS_DISPATCH_STRATEGY', value: { strategy: csDispatchStrategy } },
    });
    if (!csRes.ok) {
      const errorData = csRes.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to update CS order distribution' }, { status: safeStatus(csRes.status) });
    }

    return json({ success: true, message: 'System settings saved' });
  }

  if (intent === 'updateSystemSetting') {
    const key = formData.get('key')?.toString() ?? '';
    const rawValue = formData.get('value')?.toString() ?? '{}';

    let value: Record<string, unknown>;
    try {
      value = JSON.parse(rawValue) as Record<string, unknown>;
    } catch {
      return json({ error: 'Invalid setting value' }, { status: 400 });
    }

    // Route VOIP_ENABLED through the dedicated voip.setEnabled procedure
    // which validates Twilio credentials before enabling
    if (key === 'VOIP_ENABLED') {
      const enabled = value['enabled'] === true;
      const res = await apiRequest<unknown>('/trpc/voip.setEnabled', {
        method: 'POST',
        cookie,
        body: { enabled },
      });
      if (!res.ok) {
        const errorData = res.data as { error?: { message?: string } };
        return json({ error: errorData?.error?.message ?? 'Failed to update VOIP setting' }, { status: safeStatus(res.status) });
      }
      return json({ success: true, message: enabled ? 'VOIP enabled' : 'VOIP disabled' });
    }

    const res = await apiRequest<unknown>('/trpc/settings.updateSystemSetting', {
      method: 'POST',
      cookie,
      body: { key, value },
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to update setting' }, { status: safeStatus(res.status) });
    }
    return json({ success: true, message: 'Setting updated' });
  }

  if (intent === 'updateNotificationEmailConfig') {
    const rawEnabledTypes = formData.get('enabledTypes')?.toString() ?? '{}';
    let enabledTypes: Record<string, boolean>;
    try {
      enabledTypes = JSON.parse(rawEnabledTypes) as Record<string, boolean>;
    } catch {
      return json({ error: 'Invalid notification config' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/settings.updateNotificationEmailConfig', {
      method: 'POST',
      cookie,
      body: { enabledTypes },
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to update notification config' }, { status: safeStatus(res.status) });
    }
    return json({ success: true, message: 'Notification email settings updated' });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function SettingsRoute() {
  const { user, systemSettings, notificationEmailConfig } = useLoaderData<typeof loader>();
  return (
    <SettingsPage
      user={user}
      systemSettings={systemSettings}
      notificationEmailConfig={notificationEmailConfig}
    />
  );
}
