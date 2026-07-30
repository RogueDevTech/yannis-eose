import { defer, json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { Suspense } from 'react';
import { Await, useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, getCurrentUser, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { cachedClientLoader } from '~/lib/loader-cache';
import { SettingsPage } from '~/features/settings/SettingsPage';
import { TplSettingsLoadingShell } from '~/features/tpl/TplDeferredLoadingShells';

export const meta: MetaFunction = () => [
  { title: 'Settings: Yannis EOSE' },
];

interface SystemSetting {
  key: string;
  value: Record<string, unknown>;
  updatedBy: string | null;
  updatedAt: string;
}

interface MyNotificationPrefItem {
  type: string;
  label: string;
  description: string;
  category: string;
  enabled: boolean;
}

interface MyNotificationPrefs {
  items: MyNotificationPrefItem[];
  preferences: Record<string, boolean>;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const pageData = (async () => {
    const user = await getCurrentUser(request);
    const cookie = getSessionCookie(request);

    const [settingsRes, prefsRes] = await Promise.all([
      apiRequest<unknown>('/trpc/settings.getSystemSettings', { method: 'GET', cookie }),
      user
        ? apiRequest<unknown>('/trpc/users.getMyNotificationPreferences', { method: 'GET', cookie })
        : Promise.resolve({ ok: false as const, data: null }),
    ]);

    let systemSettings: SystemSetting[] = [];
    if (settingsRes.ok) {
      const data = settingsRes.data as { result?: { data?: SystemSetting[] } };
      systemSettings = data?.result?.data ?? [];
    }

    let myNotificationPrefs: MyNotificationPrefs | null = null;
    if (prefsRes.ok) {
      const data = prefsRes.data as { result?: { data?: MyNotificationPrefs } };
      myNotificationPrefs = data?.result?.data ?? null;
    }

    return { user, systemSettings, notificationEmailConfig: null, myNotificationPrefs };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'updateProfile') {
    const res = await apiRequest<unknown>('/trpc/users.updateMyProfile', {
      method: 'POST',
      cookie,
      body: {
        name: formData.get('name')?.toString() ?? '',
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to update profile') }, { status: safeStatus(res.status) });
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

    const res = await apiRequest<unknown>('/trpc/users.changeMyPassword', {
      method: 'POST',
      cookie,
      body: { currentPassword, newPassword },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to change password') }, { status: safeStatus(res.status) });
    }
    return json({ success: true, message: 'Password changed' });
  }

  if (intent === 'updateMyNotificationPreferences') {
    const rawPrefs = formData.get('preferences')?.toString() ?? '{}';
    let preferences: Record<string, boolean>;
    try {
      const parsed = JSON.parse(rawPrefs) as Record<string, unknown>;
      preferences = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'boolean') preferences[k] = v;
      }
    } catch {
      return json({ error: 'Invalid notification preferences' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/users.updateMyNotificationPreferences', {
      method: 'POST',
      cookie,
      body: { preferences },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to save notification preferences') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true, message: 'Notification preferences saved' });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function TplSettingsRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <Suspense fallback={<TplSettingsLoadingShell />}>
      <Await resolve={pageData}>
        {({ user, systemSettings, notificationEmailConfig, myNotificationPrefs }) => (
          <SettingsPage
            user={user}
            systemSettings={systemSettings}
            notificationEmailConfig={notificationEmailConfig}
            myNotificationPrefs={myNotificationPrefs}
          />
        )}
      </Await>
    </Suspense>
  );
}
