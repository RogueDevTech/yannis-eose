import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { APP_THEME_IDS } from '@yannis/shared';
import { apiRequest, getSessionCookie, getCurrentUser, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
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
  const user = await getCurrentUser(request);
  const cookie = getSessionCookie(request);
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  // Wave A — independent fetches for everyone with a session cookie path.
  const settingsP = apiRequest<unknown>('/trpc/settings.getSystemSettings', { method: 'GET', cookie });
  const prefsP = user
    ? apiRequest<unknown>('/trpc/users.getMyNotificationPreferences', { method: 'GET', cookie })
    : Promise.resolve({ ok: false as const, data: null });

  const [settingsRes, prefsRes] = await Promise.all([settingsP, prefsP]);

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

  let notificationEmailConfig: NotificationEmailConfig | null = null;
  let voipState: VoipState | null = null;

  // Wave B — admin-only slices in one parallel batch (notification email config + VOIP).
  if (isAdmin) {
    const [configRes, activeRes, listRes] = await Promise.all([
      apiRequest<unknown>('/trpc/settings.getNotificationEmailConfig', { method: 'GET', cookie }),
      apiRequest<unknown>('/trpc/voip.isEnabled', { method: 'GET', cookie }),
      apiRequest<unknown>('/trpc/voip.listProviders', { method: 'GET', cookie }),
    ]);
    if (configRes.ok) {
      const data = configRes.data as { result?: { data?: NotificationEmailConfig } };
      notificationEmailConfig = data?.result?.data ?? null;
    }
    const active = activeRes.ok
      ? (activeRes.data as { result?: { data?: VoipActive } })?.result?.data ?? null
      : null;
    const list = listRes.ok
      ? (listRes.data as { result?: { data?: VoipProviderInfo[] } })?.result?.data ?? null
      : null;
    if (active && list) voipState = { active, providers: list };
  }

  return { user, systemSettings, notificationEmailConfig, voipState, myNotificationPrefs };
}

interface VoipActive {
  enabled: boolean;
  provider: 'africas_talking';
  providerDisplayName: string;
  supportsBrowserClient: boolean;
}
interface VoipProviderInfo {
  name: 'africas_talking';
  displayName: string;
  configured: boolean;
  requiredEnvVars: string[];
  supportsBrowserClient: boolean;
}
export interface VoipState {
  active: VoipActive;
  providers: VoipProviderInfo[];
}

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

  if (intent === 'updateSystemSettings') {
    const voipEnabled = formData.get('voipEnabled')?.toString() === 'true';
    const csDispatchStrategy = formData.get('csDispatchStrategy')?.toString() ?? 'manual';
    if (
      csDispatchStrategy !== 'manual' &&
      csDispatchStrategy !== 'load_balanced' &&
      csDispatchStrategy !== 'performance' &&
      csDispatchStrategy !== 'claim'
    ) {
      return json({ error: 'Invalid CS dispatch strategy' }, { status: 400 });
    }
    const claimCapRaw = formData.get('claimCap')?.toString();
    const claimCap = claimCapRaw ? parseInt(claimCapRaw, 10) : 2;
    if (isNaN(claimCap) || claimCap < 1 || claimCap > 20) {
      return json({ error: 'Claim cap must be between 1 and 20' }, { status: 400 });
    }

    // 1. VOIP (dedicated procedure)
    const voipRes = await apiRequest<unknown>('/trpc/voip.setEnabled', {
      method: 'POST',
      cookie,
      body: { enabled: voipEnabled },
    });
    if (!voipRes.ok) {
      return json({ error: extractApiErrorMessage(voipRes.data, 'Failed to update VOIP setting') }, { status: safeStatus(voipRes.status) });
    }

    // 2. CS dispatch strategy
    const csRes = await apiRequest<unknown>('/trpc/settings.updateSystemSetting', {
      method: 'POST',
      cookie,
      body: { key: 'CS_DISPATCH_STRATEGY', value: { strategy: csDispatchStrategy } },
    });
    if (!csRes.ok) {
      return json({ error: extractApiErrorMessage(csRes.data, 'Failed to update CS order distribution') }, { status: safeStatus(csRes.status) });
    }

    // 3. Claim cap (saved regardless of mode — used when claim mode is active)
    const capRes = await apiRequest<unknown>('/trpc/settings.updateSystemSetting', {
      method: 'POST',
      cookie,
      body: { key: 'CS_CLAIM_CAP', value: { cap: claimCap } },
    });
    if (!capRes.ok) {
      return json({ error: extractApiErrorMessage(capRes.data, 'Failed to update claim cap') }, { status: safeStatus(capRes.status) });
    }

    const defaultAppTheme = formData.get('defaultAppTheme')?.toString() ?? 'system';
    if (!(APP_THEME_IDS as readonly string[]).includes(defaultAppTheme)) {
      return json({ error: 'Invalid default theme' }, { status: 400 });
    }
    const uiRes = await apiRequest<unknown>('/trpc/settings.updateClientUiConfig', {
      method: 'POST',
      cookie,
      body: { defaultAppTheme },
    });
    if (!uiRes.ok) {
      return json(
        { error: extractApiErrorMessage(uiRes.data, 'Failed to update default appearance') },
        { status: safeStatus(uiRes.status) },
      );
    }

    // 4. Marketing profitability config (target ROAS + green/red threshold)
    const profitTargetRaw = formData.get('profitabilityTargetRoas')?.toString();
    const profitThresholdRaw = formData.get('profitabilityGreenThreshold')?.toString();
    const profitTarget = profitTargetRaw != null ? Number(profitTargetRaw) : null;
    const profitThreshold = profitThresholdRaw != null ? Number(profitThresholdRaw) : null;
    if (
      profitTarget != null &&
      (!Number.isFinite(profitTarget) || profitTarget <= 0 || profitTarget > 50)
    ) {
      return json({ error: 'Profitability target ROAS must be between 0 and 50' }, { status: 400 });
    }
    if (
      profitThreshold != null &&
      (!Number.isFinite(profitThreshold) || profitThreshold <= 0 || profitThreshold > 50)
    ) {
      return json({ error: 'Profitability green threshold must be between 0 and 50' }, { status: 400 });
    }
    if (profitTarget != null && profitThreshold != null && profitThreshold > profitTarget) {
      return json(
        { error: 'Green threshold cannot be higher than the target ROAS — green is what reaches/exceeds the target.' },
        { status: 400 },
      );
    }
    if (profitTarget != null || profitThreshold != null) {
      const profitRes = await apiRequest<unknown>('/trpc/settings.updateSystemSetting', {
        method: 'POST',
        cookie,
        body: {
          key: 'MARKETING_PROFITABILITY',
          value: {
            targetRoas: profitTarget ?? 3,
            greenThreshold: profitThreshold ?? 2.5,
          },
        },
      });
      if (!profitRes.ok) {
        return json(
          { error: extractApiErrorMessage(profitRes.data, 'Failed to update profitability config') },
          { status: safeStatus(profitRes.status) },
        );
      }
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
    // which validates the active provider's credentials (AT) before enabling
    if (key === 'VOIP_ENABLED') {
      const enabled = value['enabled'] === true;
      const res = await apiRequest<unknown>('/trpc/voip.setEnabled', {
        method: 'POST',
        cookie,
        body: { enabled },
      });
      if (!res.ok) {
        return json({ error: extractApiErrorMessage(res.data, 'Failed to update VOIP setting') }, { status: safeStatus(res.status) });
      }
      return json({ success: true, message: enabled ? 'VOIP enabled' : 'VOIP disabled' });
    }

    const res = await apiRequest<unknown>('/trpc/settings.updateSystemSetting', {
      method: 'POST',
      cookie,
      body: { key, value },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to update setting') }, { status: safeStatus(res.status) });
    }
    return json({ success: true, message: 'Setting updated' });
  }

  if (intent === 'setVoipProvider') {
    const provider = formData.get('provider')?.toString() ?? '';
    if (provider !== 'africas_talking') {
      return json({ error: 'Unknown VOIP provider' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/voip.setProvider', {
      method: 'POST',
      cookie,
      body: { provider },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to switch VOIP provider') }, { status: safeStatus(res.status) });
    }
    return json({ success: true, message: `VOIP provider switched to Africa's Talking` });
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

    const res = await apiRequest<unknown>(
      '/trpc/users.updateMyNotificationPreferences',
      {
        method: 'POST',
        cookie,
        body: { preferences },
      },
    );
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to save notification preferences') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true, message: 'Notification preferences saved' });
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
      return json({ error: extractApiErrorMessage(res.data, 'Failed to update notification config') }, { status: safeStatus(res.status) });
    }
    return json({ success: true, message: 'Notification email settings updated' });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function SettingsIndexRoute() {
  const { user, systemSettings, notificationEmailConfig, voipState, myNotificationPrefs } =
    useLoaderData<typeof loader>();
  return (
    <>
    <SettingsPage
      user={user}
      systemSettings={systemSettings}
      notificationEmailConfig={notificationEmailConfig}
      voipState={voipState}
      myNotificationPrefs={myNotificationPrefs}
    />
    </>
  );
}
