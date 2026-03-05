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

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  const cookie = getSessionCookie(request);

  let systemSettings: SystemSetting[] = [];
  const settingsRes = await apiRequest<unknown>(
    '/trpc/settings.getSystemSettings',
    { method: 'GET', cookie },
  );
  if (settingsRes.ok) {
    const data = settingsRes.data as { result?: { data?: SystemSetting[] } };
    systemSettings = data?.result?.data ?? [];
  }

  return { user, systemSettings, notificationEmailConfig: null };
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

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function TplSettingsRoute() {
  const { user, systemSettings, notificationEmailConfig } = useLoaderData<typeof loader>();
  return (
    <SettingsPage
      user={user}
      systemSettings={systemSettings}
      notificationEmailConfig={notificationEmailConfig}
    />
  );
}
