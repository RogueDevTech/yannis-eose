import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Link, useFetcher, useLocation, useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import { Tabs } from '~/components/ui/tabs';
import { usePwaInstall } from '~/hooks/usePwaInstall';
import { ROLE_LABELS } from './types';
import { useAppTheme } from '~/hooks/useAppTheme';
import { useFontScale } from '~/hooks/useFontScale';
import { APP_THEMES, previewRgb, THEME_PREVIEW_BRAND_HEX, THEME_PREVIEW_RGB } from '~/lib/theme';
import { FONT_SCALES } from '~/lib/font-scale';
import { SettingsPushPanel } from './SettingsPushPanel';
import { PageHeader } from '~/components/ui/page-header';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { humanizeZodIssuesString } from '~/lib/api-error';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { TextInput } from '~/components/ui/text-input';
import { NumberInput } from '~/components/ui/number-input';
import { Collapsible } from '~/components/ui/collapsible';

interface SettingsUser {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions?: string[];
}

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

interface VoipProviderInfo {
  name: 'africas_talking';
  displayName: string;
  configured: boolean;
  requiredEnvVars: string[];
  supportsBrowserClient: boolean;
}
interface VoipActiveInfo {
  enabled: boolean;
  provider: 'africas_talking';
  providerDisplayName: string;
  supportsBrowserClient: boolean;
}
export interface SettingsVoipState {
  active: VoipActiveInfo;
  providers: VoipProviderInfo[];
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

interface SettingsPageProps {
  user: SettingsUser | null;
  systemSettings?: SystemSetting[];
  notificationEmailConfig?: NotificationEmailConfig | null;
  /** SuperAdmin/Admin only: active provider + list of all providers for the picker. */
  voipState?: SettingsVoipState | null;
  /** Per-user notification preferences (visible to all roles). */
  myNotificationPrefs?: MyNotificationPrefs | null;
}

export type SettingsTabId =
  | 'profile'
  | 'security'
  | 'notifications'
  | 'push'
  | 'system'
  | 'orgEmails';


function ThemeAppearanceOption({
  theme: t,
  selected,
  onSelect,
}: {
  theme: (typeof APP_THEMES)[number];
  selected: boolean;
  onSelect: () => void;
}) {
  const p = t.preview;
  const preview =
    t.id === 'system' ? (
      <div
        className="mb-2 h-[4.75rem] w-full overflow-hidden rounded-lg shadow-sm ring-1 ring-black/[0.06] dark:ring-white/[0.08] flex flex-col"
        aria-hidden
      >
        <div className="flex h-2.5 w-full shrink-0">
          <div
            className="h-full w-1/2 border-b border-r border-black/[0.06]"
            style={{
              backgroundColor: previewRgb(THEME_PREVIEW_RGB.light.logoStrip),
              borderBottomColor: previewRgb(THEME_PREVIEW_RGB.light.border),
            }}
          />
          <div
            className="h-full w-1/2 border-b"
            style={{
              backgroundColor: previewRgb(THEME_PREVIEW_RGB.ink.logoStrip),
              borderBottomColor: previewRgb(THEME_PREVIEW_RGB.ink.border),
            }}
          />
        </div>
        <div className="flex min-h-0 flex-1 min-w-0">
          {([THEME_PREVIEW_RGB.light, THEME_PREVIEW_RGB.ink] as const).map((side, i) => (
            <div
              key={i}
              className={`flex w-1/2 gap-0.5 p-0.5 ${i === 0 ? 'border-r border-black/[0.06]' : ''}`}
              style={{ backgroundColor: previewRgb(side.canvas) }}
            >
              <div
                className="w-[22%] shrink-0 rounded-sm"
                style={{
                  backgroundColor: previewRgb(side.elevated),
                  boxShadow: `inset 0 0 0 1px ${previewRgb(side.border)}`,
                }}
              />
              <div
                className="relative min-w-0 flex-1 rounded-sm"
                style={{
                  backgroundColor: previewRgb(side.elevated),
                  boxShadow: `inset 0 0 0 1px ${previewRgb(side.border)}`,
                }}
              >
                <div
                  className="absolute left-1 top-1 h-0.5 w-6 max-w-[55%] rounded-full opacity-35"
                  style={{ backgroundColor: previewRgb(side.fg) }}
                />
                <div
                  className="absolute bottom-1 right-1 h-1.5 w-6 rounded-full"
                  style={{ backgroundColor: THEME_PREVIEW_BRAND_HEX }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    ) : (
      <div
        className="mb-2 h-[4.75rem] w-full overflow-hidden rounded-lg shadow-sm ring-1 ring-black/[0.06] dark:ring-white/[0.08]"
        aria-hidden
      >
        <div className="h-2.5 w-full border-b" style={{ backgroundColor: previewRgb(p.logoStrip), borderColor: previewRgb(p.border) }} />
        <div className="flex h-[calc(100%-0.625rem)] gap-1 p-1" style={{ backgroundColor: previewRgb(p.canvas) }}>
          <div
            className="w-[24%] shrink-0 rounded-sm"
            style={{
              backgroundColor: previewRgb(p.elevated),
              boxShadow: `inset 0 0 0 1px ${previewRgb(p.border)}`,
            }}
          />
          <div
            className="relative min-w-0 flex-1 rounded-sm"
            style={{
              backgroundColor: previewRgb(p.elevated),
              boxShadow: `inset 0 0 0 1px ${previewRgb(p.border)}`,
            }}
          >
            <div
              className="absolute left-1.5 top-1.5 h-1 w-9 max-w-[55%] rounded-full opacity-35"
              style={{ backgroundColor: previewRgb(p.fg) }}
            />
            <div
              className="absolute bottom-1.5 right-1.5 h-2 w-8 rounded-full"
              style={{ backgroundColor: THEME_PREVIEW_BRAND_HEX }}
            />
          </div>
        </div>
      </div>
    );
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${t.label} theme`}
      className={`rounded-xl border p-2.5 text-left transition-colors ${
        selected
          ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30 ring-1 ring-brand-500/30'
          : 'border-app-border hover:bg-app-hover/50'
      }`}
    >
      {preview}
      <span
        className={`text-sm font-medium ${
          selected ? 'text-brand-800 dark:text-brand-200' : 'text-app-fg-muted'
        }`}
      >
        {t.label}
      </span>
    </button>
  );
}

function tabLabel(tab: SettingsTabId): string {
  switch (tab) {
    case 'profile':
      return 'Profile';
    case 'security':
      return 'Security';
    case 'notifications':
      return 'Notifications';
    case 'push':
      return 'Push';
    case 'system':
      return 'System';
    case 'orgEmails':
      return 'Org email';
    default:
      return tab;
  }
}

const NOTIFICATION_CATEGORY_LABELS: Record<string, string> = {
  orders: 'Orders',
  marketing: 'Marketing',
  finance: 'Finance',
  logistics: 'Logistics',
  hr: 'Payroll & HR',
  approvals: 'Approvals',
  account: 'Account',
};

function NotificationPreferenceToggle({
  checked,
  onToggle,
  ariaLabel,
}: {
  checked: boolean;
  onToggle: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-surface-900 ${
        checked ? 'bg-brand-600' : 'bg-app-border'
      }`}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

export function SettingsPage({
  user,
  systemSettings = [],
  notificationEmailConfig,
  voipState,
  myNotificationPrefs,
}: SettingsPageProps) {
  const fetcher = useFetcher();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const installAnchorRef = useRef<HTMLDivElement | null>(null);

  // Treat SUPER_ADMIN and ADMIN identically for settings visibility (System + OrgEmails tabs).
  const isSuperAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  const allowedTabs = useMemo((): SettingsTabId[] => {
    return isSuperAdmin
      ? ['profile', 'security', 'notifications', 'push', 'system', 'orgEmails']
      : ['profile', 'security', 'notifications', 'push'];
  }, [isSuperAdmin]);

  const resolveTab = useCallback(
    (raw: string | null): SettingsTabId => {
      if (raw && allowedTabs.includes(raw as SettingsTabId)) return raw as SettingsTabId;
      return 'profile';
    },
    [allowedTabs],
  );

  const [activeTab, setActiveTab] = useState<SettingsTabId>(() => resolveTab(searchParams.get('tab')));

  useEffect(() => {
    setActiveTab(resolveTab(searchParams.get('tab')));
  }, [searchParams, resolveTab]);

  const handleTabChange = useCallback(
    (value: string) => {
      const next = resolveTab(value);
      setActiveTab(next);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set('tab', next);
      if (next !== 'system') {
        nextParams.delete('section');
        nextParams.delete('branchId');
      }
      setSearchParams(nextParams, { replace: true });
    },
    [resolveTab, searchParams, setSearchParams],
  );
  const [profileName, setProfileName] = useState(user?.name ?? '');
  const { themeId, setTheme, activeTheme } = useAppTheme();
  const { fontScaleId, setFontScale, activeScale } = useFontScale();
  const { canInstall, install, canPromptInstall, isIosManualInstall, isInstalled } = usePwaInstall();

  // CS dispatch strategy: derived from settings, local state for form selection
  const csDispatchSetting = systemSettings.find((s) => s.key === 'CS_DISPATCH_STRATEGY');
  const rawStrategy = csDispatchSetting?.value?.strategy;
  const dispatchStrategyFromSettings: 'manual' | 'load_balanced' | 'performance' | 'claim' =
    rawStrategy === 'performance'
      ? 'performance'
      : rawStrategy === 'claim'
        ? 'claim'
        : rawStrategy === 'load_balanced'
          ? 'load_balanced'
          : 'manual';
  const [selectedDispatchStrategy, setSelectedDispatchStrategy] = useState<'manual' | 'load_balanced' | 'performance' | 'claim'>(dispatchStrategyFromSettings);

  // Claim cap setting
  const claimCapSetting = systemSettings.find((s) => s.key === 'CS_CLAIM_CAP');
  const claimCapFromSettings = typeof claimCapSetting?.value?.cap === 'number' ? claimCapSetting.value.cap : 2;
  const [localClaimCap, setLocalClaimCap] = useState<number>(claimCapFromSettings);

  // Marketing profitability config — target ROAS where score caps at 1.0, plus the green/red
  // threshold used by the Team page Profitability column and the Leaderboard ROAS pill.
  // Defaults: target=3x, green=2.5x (CEO directive 2026-05-03).
  const profitabilitySetting = systemSettings.find((s) => s.key === 'MARKETING_PROFITABILITY');
  const profitabilityTargetSaved =
    typeof profitabilitySetting?.value?.targetRoas === 'number' ? profitabilitySetting.value.targetRoas : 3;
  const profitabilityThresholdSaved =
    typeof profitabilitySetting?.value?.greenThreshold === 'number'
      ? profitabilitySetting.value.greenThreshold
      : 2.5;
  const [localProfitabilityTarget, setLocalProfitabilityTarget] = useState<number>(profitabilityTargetSaved);
  const [localProfitabilityThreshold, setLocalProfitabilityThreshold] = useState<number>(profitabilityThresholdSaved);

  // Local state for notification email toggles (configurable types only)
  const [enabledTypes, setEnabledTypes] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const initial: Record<string, boolean> = {};
    notificationEmailConfig?.configurable?.forEach((c) => {
      initial[c.type] = c.emailEnabled;
    });
    setEnabledTypes(initial);
  }, [notificationEmailConfig]);

  // Local state for the per-user notification opt-out toggles. Default = enabled
  // unless the server says explicitly false. Saved as `{type: boolean}` map.
  const [myNotifEnabled, setMyNotifEnabled] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const initial: Record<string, boolean> = {};
    myNotificationPrefs?.items?.forEach((item) => {
      initial[item.type] = item.enabled;
    });
    setMyNotifEnabled(initial);
  }, [myNotificationPrefs]);

  const myNotifGroupedItems = useMemo(() => {
    const groups: Record<string, MyNotificationPrefItem[]> = {};
    (myNotificationPrefs?.items ?? []).forEach((item) => {
      const key = item.category;
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    return groups;
  }, [myNotificationPrefs]);

  const myNotifSavedMap = useMemo(() => {
    const m: Record<string, boolean> = {};
    (myNotificationPrefs?.items ?? []).forEach((item) => {
      m[item.type] = item.enabled;
    });
    return m;
  }, [myNotificationPrefs]);

  const myNotifHasChanges = useMemo(() => {
    return Object.keys(myNotifEnabled).some(
      (k) => myNotifEnabled[k] !== myNotifSavedMap[k],
    );
  }, [myNotifEnabled, myNotifSavedMap]);

  const settingsSurface = useFetcherActionSurface(fetcher);
  const actionData = fetcher.data as { error?: string; success?: boolean; message?: string } | undefined;
  const [dismissedError, setDismissedError] = useState(false);
  const [confirmSystemOpen, setConfirmSystemOpen] = useState(false);
  const systemFormRef = useRef<HTMLFormElement | null>(null);
  const [dismissedSuccess, setDismissedSuccess] = useState(false);

  const systemSettingsErrorInline =
    confirmSystemOpen && settingsSurface.errorMatchingIntent('updateSystemSettings');

  useFetcherToast(fetcher.data, {
    successMessage: 'Settings saved',
    skipErrorToast: Boolean(systemSettingsErrorInline),
  });

  useEffect(() => {
    if (actionData?.error) setDismissedError(false);
    if (actionData?.success) setDismissedSuccess(false);
  }, [actionData?.error, actionData?.success]);

  useEffect(() => {
    if (fetcher.state === 'idle' && actionData?.success) {
      setConfirmSystemOpen(false);
    }
  }, [fetcher.state, actionData?.success]);

  // Derive feature flag states from system settings
  const voipSetting = systemSettings.find((s) => s.key === 'VOIP_ENABLED');
  const isVoipEnabled = voipSetting?.value?.['enabled'] === true;

  // Local state for System tab: user can toggle all then submit once
  const [localVoipEnabled, setLocalVoipEnabled] = useState(isVoipEnabled);
  useEffect(() => {
    setLocalVoipEnabled(isVoipEnabled);
  }, [isVoipEnabled]);
  useEffect(() => {
    setSelectedDispatchStrategy(dispatchStrategyFromSettings);
  }, [dispatchStrategyFromSettings]);
  useEffect(() => {
    setLocalClaimCap(claimCapFromSettings);
  }, [claimCapFromSettings]);
  useEffect(() => {
    setLocalProfitabilityTarget(profitabilityTargetSaved);
  }, [profitabilityTargetSaved]);
  useEffect(() => {
    setLocalProfitabilityThreshold(profitabilityThresholdSaved);
  }, [profitabilityThresholdSaved]);

  useEffect(() => {
    if (location.hash !== '#install-app') return;
    setActiveTab('profile');
    setSearchParams({ tab: 'profile' }, { replace: true });
    requestAnimationFrame(() => {
      installAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [location.hash, location.pathname, setSearchParams]);

  const hasSystemChanges =
    localVoipEnabled !== isVoipEnabled ||
    selectedDispatchStrategy !== dispatchStrategyFromSettings ||
    localClaimCap !== claimCapFromSettings ||
    localProfitabilityTarget !== profitabilityTargetSaved ||
    localProfitabilityThreshold !== profitabilityThresholdSaved;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        description="Manage your account and system preferences"
        actions={<PageRefreshButton />}
      />

      <Tabs
        value={activeTab}
        onChange={handleTabChange}
        tabs={allowedTabs.map((tab) => ({
          value: tab,
          label: tabLabel(tab),
        }))}
      />

      {actionData?.error &&
        !dismissedError &&
        !systemSettingsErrorInline && (
        <PageNotification
          variant="error"
          message={humanizeZodIssuesString(actionData.error)}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}
      {actionData?.success && !dismissedSuccess && (
        <PageNotification
          variant="success"
          message={actionData.message ?? 'Settings saved.'}
          durationMs={5000}
          onDismiss={() => setDismissedSuccess(true)}
        />
      )}

      {/* Profile Tab */}
      {activeTab === 'profile' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card">
            <h3 className="text-lg font-semibold text-app-fg mb-4">Account Information</h3>
            <div className="space-y-4">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 rounded-full bg-brand-100 dark:bg-brand-700/30 flex items-center justify-center">
                  <span className="text-xl font-bold text-brand-600 dark:text-brand-400">
                    {(user?.name ?? '?').split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                  </span>
                </div>
                <div>
                  <p className="text-lg font-semibold text-app-fg">{user?.name ?? 'Unknown'}</p>
                  <p className="text-sm text-app-fg-muted">{ROLE_LABELS[user?.role ?? ''] ?? user?.role}</p>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">Email</label>
                <p className="text-sm text-app-fg mt-1">{user?.email ?? '—'}</p>
              </div>

              <div>
                <label className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">Role</label>
                <p className="text-sm text-app-fg mt-1">{ROLE_LABELS[user?.role ?? ''] ?? user?.role ?? '—'}</p>
              </div>
            </div>
          </div>

          <fetcher.Form method="post" className="card">
            <h3 className="text-lg font-semibold text-app-fg mb-4">Edit Profile</h3>
            <input type="hidden" name="intent" value="updateProfile" />
            <div className="space-y-4">
              <div>
                <TextInput
                  id="name"
                  name="name"
                  label="Display Name"
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Saving...">
                Save Changes
              </Button>
            </div>
          </fetcher.Form>

          <div className="card lg:col-span-2">
            <h3 className="text-lg font-semibold text-app-fg mb-4">Appearance</h3>
            <p className="text-xs text-app-fg-muted mb-3">
              Current: <span className="font-medium text-app-fg">{activeTheme.label}</span>
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {APP_THEMES.map((t) => (
                <ThemeAppearanceOption
                  key={t.id}
                  theme={t}
                  selected={themeId === t.id}
                  onSelect={() => setTheme(t.id)}
                />
              ))}
            </div>
          </div>

          <div className="card lg:col-span-2">
            <h3 className="text-lg font-semibold text-app-fg mb-4">Text size</h3>
            <p className="text-xs text-app-fg-muted mb-3">
              Adjusts text and spacing across the app on this device and any device you sign in to. Current: <span className="font-medium text-app-fg">{activeScale.label}</span>
            </p>
            <div className="grid grid-cols-3 gap-3">
              {FONT_SCALES.map((s) => {
                const selected = fontScaleId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setFontScale(s.id)}
                    className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border px-3 py-4 transition ${
                      selected
                        ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20 ring-2 ring-brand-500/30'
                        : 'border-app-border bg-app-elevated hover:border-app-border-strong'
                    }`}
                    aria-pressed={selected}
                  >
                    <span
                      className="font-semibold text-app-fg leading-none"
                      style={{ fontSize: `${s.rootPx + 6}px` }}
                    >
                      {s.sample}
                    </span>
                    <span className="text-xs text-app-fg-muted">{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {!isInstalled && <div ref={installAnchorRef} id="install-app" className="card lg:col-span-2 scroll-mt-24">
            <h3 className="text-lg font-semibold text-app-fg mb-4">Install app</h3>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between rounded-lg border border-app-border px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-app-fg">Add to home screen</p>
                <p className="text-xs text-app-fg-muted mt-0.5">
                  {isIosManualInstall
                    ? 'On iPhone or iPad (Safari or Chrome), use Share, then Add to Home Screen.'
                    : 'Install Yannis for faster launch and better offline behavior.'}
                </p>
                {isIosManualInstall ? (
                  <details className="mt-2 rounded-lg border border-app-border bg-app-hover px-2.5 py-2">
                    <summary className="cursor-pointer text-xs font-semibold text-app-fg-muted">
                      Show steps
                    </summary>
                    <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-app-fg-muted">
                      <li>Tap Share in the browser toolbar (often at the bottom on iPhone).</li>
                      <li>Tap Add to Home Screen.</li>
                      <li>Tap Add to finish.</li>
                    </ol>
                  </details>
                ) : null}
              </div>
              {isIosManualInstall ? null : (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="shrink-0 self-end sm:self-start"
                  disabled={!canInstall && !canPromptInstall}
                  onClick={() => void install()}
                >
                  Install App
                </Button>
              )}
            </div>
          </div>}
        </div>
      )}

      {/* Security Tab */}
      {activeTab === 'security' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <fetcher.Form method="post" className="card">
            <h3 className="text-lg font-semibold text-app-fg mb-4">Change Password</h3>
            <input type="hidden" name="intent" value="changePassword" />
            <div className="space-y-4">
              <TextInput
                id="currentPassword"
                name="currentPassword"
                label="Current Password"
                type="password"
                required
                autoComplete="current-password"
              />
              <TextInput
                id="newPassword"
                name="newPassword"
                label="New Password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
              <TextInput
                id="confirmPassword"
                name="confirmPassword"
                label="Confirm New Password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
              <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Updating...">
                Change Password
              </Button>
            </div>
          </fetcher.Form>

        </div>
      )}

      {/* Notifications Tab — per-user opt-outs (in-app + push + email gate together) */}
      {activeTab === 'notifications' && (
        <div className="space-y-6">
          <fetcher.Form method="post" className="space-y-6">
            <input type="hidden" name="intent" value="updateMyNotificationPreferences" />
            <input type="hidden" name="preferences" value={JSON.stringify(myNotifEnabled)} />

            <div className="card">
              <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-app-fg">My notifications</h3>
                  <p className="mt-0.5 text-sm text-app-fg-muted">
                    Choose which notifications you receive. Turning a type off stops all delivery
                    for that type — in-app, push, and email. You can turn it back on any time.
                  </p>
                </div>
                {myNotificationPrefs && myNotificationPrefs.items.length > 0 && (
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:shrink-0 sm:flex-row sm:items-center">
                    <span className="text-xs font-medium text-app-fg-muted sm:whitespace-nowrap">
                      Toggle all
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="min-h-[2.25rem] flex-1 sm:flex-initial"
                        onClick={() => {
                          const allOn: Record<string, boolean> = {};
                          myNotificationPrefs.items.forEach((i) => {
                            allOn[i.type] = true;
                          });
                          setMyNotifEnabled(allOn);
                        }}
                      >
                        Enable all
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="min-h-[2.25rem] flex-1 sm:flex-initial"
                        onClick={() => {
                          const allOff: Record<string, boolean> = {};
                          myNotificationPrefs.items.forEach((i) => {
                            allOff[i.type] = false;
                          });
                          setMyNotifEnabled(allOff);
                        }}
                      >
                        Disable all
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {!myNotificationPrefs ? (
                <p className="text-sm text-app-fg-muted">Loading notification settings…</p>
              ) : myNotificationPrefs.items.length === 0 ? (
                <p className="text-sm text-app-fg-muted">
                  No optional notifications for your role. Action-required alerts always
                  reach you so you don&apos;t miss anything urgent.
                </p>
              ) : (
                <div className="space-y-4 sm:space-y-6">
                  {Object.keys(myNotifGroupedItems)
                    .sort()
                    .map((category) => (
                      <div key={category}>
                        <h4 className="mb-2 text-sm font-medium text-app-fg-muted sm:mb-3">
                          {NOTIFICATION_CATEGORY_LABELS[category] ?? category}
                        </h4>
                        <div className="space-y-2 sm:space-y-3">
                          {myNotifGroupedItems[category]!.map((item) => {
                            const enabled = myNotifEnabled[item.type] ?? false;
                            const aria = `Toggle notifications for ${item.label}`;
                            const flip = () =>
                              setMyNotifEnabled((prev) => ({
                                ...prev,
                                [item.type]: !prev[item.type],
                              }));
                            return (
                              <div
                                key={item.type}
                                className="rounded-lg border border-app-border px-2.5 py-2 sm:flex sm:items-center sm:justify-between sm:gap-4 sm:px-4 sm:py-3"
                              >
                                <div className="min-w-0 flex-1 sm:pr-4">
                                  <div className="flex items-start justify-between gap-2">
                                    <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-app-fg">
                                      {item.label}
                                    </p>
                                    <div className="shrink-0 pt-0.5 sm:hidden">
                                      <NotificationPreferenceToggle
                                        checked={enabled}
                                        onToggle={flip}
                                        ariaLabel={aria}
                                      />
                                    </div>
                                  </div>
                                  <p className="mt-1 text-xs leading-snug text-app-fg-muted sm:mt-0.5">
                                    {item.description}
                                  </p>
                                </div>
                                <div className="hidden shrink-0 sm:flex sm:items-center">
                                  <NotificationPreferenceToggle
                                    checked={enabled}
                                    onToggle={flip}
                                    ariaLabel={aria}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}

                  <div className="flex flex-col gap-2 border-t border-app-border pt-4 sm:flex-row sm:items-center">
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      className="w-full min-h-[2.5rem] sm:w-auto"
                      disabled={!myNotifHasChanges || fetcher.state === 'submitting'}
                      loading={fetcher.state === 'submitting'}
                      loadingText="Saving..."
                    >
                      Save notification preferences
                    </Button>
                    {myNotifHasChanges && (
                      <span className="text-xs text-app-fg-muted sm:ml-3">
                        You have unsaved changes
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </fetcher.Form>
        </div>
      )}

      {activeTab === 'push' && <SettingsPushPanel userId={user?.id ?? null} />}

      {/* System Tab — grouped form: toggle VOIP, CS distribution then submit once */}
      {activeTab === 'system' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {isSuperAdmin ? (
            <fetcher.Form method="post" className="contents" ref={systemFormRef}>
              <input type="hidden" name="intent" value="updateSystemSettings" />
              <input type="hidden" name="voipEnabled" value={localVoipEnabled ? 'true' : 'false'} />
              <input type="hidden" name="csDispatchStrategy" value={selectedDispatchStrategy} />
              <input type="hidden" name="claimCap" value={String(localClaimCap)} />
              <input
                type="hidden"
                name="profitabilityTargetRoas"
                value={String(localProfitabilityTarget)}
              />
              <input
                type="hidden"
                name="profitabilityGreenThreshold"
                value={String(localProfitabilityThreshold)}
              />

              {/* VOIP Integration */}
              <div className="card lg:col-span-2">
                <Collapsible
                  contentClassName="mt-4"
                  trigger={
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center">
                        <svg className="w-5 h-5 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-app-fg">VOIP Integration</h3>
                        <p className="text-sm text-app-fg-muted">Africa's Talking phone-to-phone bridging for CS closers</p>
                      </div>
                    </div>
                  }
                >
                <div className="rounded-lg border border-app-border p-4 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <p className="text-sm font-semibold text-app-fg">
                          VOIP Calling{voipState ? ` (${voipState.active.providerDisplayName})` : ''}
                        </p>
                        {localVoipEnabled ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-success-50 dark:bg-success-700/20 px-2.5 py-0.5 text-xs font-medium text-success-700 dark:text-success-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-success-500" /> Enabled
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-app-hover px-2.5 py-0.5 text-xs font-medium text-app-fg-muted">
                            <span className="w-1.5 h-1.5 rounded-full bg-surface-400" /> Disabled
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-app-fg-muted leading-relaxed">
                        {localVoipEnabled
                          ? voipState?.active.supportsBrowserClient === false
                            ? `Agents click Call → ${voipState.active.providerDisplayName} dials the agent's phone, then bridges to the customer. Calls are tracked and the 15-second confirm gate is enforced. Orders are locked for 15 minutes during calls.`
                            : 'Agents use the browser SDK to call customers. Calls are tracked, recorded, and the 15-second confirm gate is enforced. Orders are locked for 15 minutes during calls.'
                          : 'VOIP is off. Agents will log manual calls. Less control over the call process.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setLocalVoipEnabled(!localVoipEnabled)}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-surface-900 ${
                        localVoipEnabled ? 'bg-brand-600' : 'bg-app-border'
                      }`}
                      disabled={fetcher.state === 'submitting'}
                      role="switch"
                      aria-checked={localVoipEnabled}
                      aria-label="Toggle VOIP"
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          localVoipEnabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Provider picker — separate fetcher so it submits on change rather than waiting
                      for the System tab's main Save button. Surfaces unconfigured providers with a
                      tooltip listing the env vars they need. */}
                  {voipState && (
                    <VoipProviderPicker active={voipState.active.provider} providers={voipState.providers} />
                  )}
                </div>
                </Collapsible>
              </div>

              {/* CS Order Distribution */}
              <div className="card lg:col-span-2">
                <Collapsible
                  contentClassName="mt-4"
                  trigger={
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center">
                        <svg className="w-5 h-5 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 006 3.75h2.25A2.25 2.25 0 0010.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-app-fg">CS order distribution</h3>
                        <p className="text-sm text-app-fg-muted">How new orders are assigned to CS closers when they come in</p>
                      </div>
                    </div>
                  }
                >
                <div className="rounded-lg border border-app-border p-4">
                  <div className="space-y-3">
                    <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-app-border p-4 hover:bg-app-hover/50 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 dark:has-[:checked]:bg-brand-700/20">
                      <input
                        type="radio"
                        name="strategy"
                        value="manual"
                        checked={selectedDispatchStrategy === 'manual'}
                        onChange={() => setSelectedDispatchStrategy('manual')}
                        className="mt-1 text-brand-600 border-app-border focus:ring-brand-500"
                      />
                      <div>
                        <p className="text-sm font-medium text-app-fg">Manual assignment</p>
                        <p className="text-xs text-app-fg-muted mt-0.5">
                          No auto-assignment. New orders sit in the Unassigned queue until Head of CS assigns them. Agents cannot claim or pull orders themselves.
                        </p>
                      </div>
                    </label>
                    <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-app-border p-4 hover:bg-app-hover/50 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 dark:has-[:checked]:bg-brand-700/20">
                      <input
                        type="radio"
                        name="strategy"
                        value="load_balanced"
                        checked={selectedDispatchStrategy === 'load_balanced'}
                        onChange={() => setSelectedDispatchStrategy('load_balanced')}
                        className="mt-1 text-brand-600 border-app-border focus:ring-brand-500"
                      />
                      <div>
                        <p className="text-sm font-medium text-app-fg">Load balanced</p>
                        <p className="text-xs text-app-fg-muted mt-0.5">
                          Distribute by current workload: agents with fewer pending orders get new orders first. Tie-break: most idle.
                        </p>
                      </div>
                    </label>
                    <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-app-border p-4 hover:bg-app-hover/50 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 dark:has-[:checked]:bg-brand-700/20">
                      <input
                        type="radio"
                        name="strategy"
                        value="performance"
                        checked={selectedDispatchStrategy === 'performance'}
                        onChange={() => setSelectedDispatchStrategy('performance')}
                        className="mt-1 text-brand-600 border-app-border focus:ring-brand-500"
                      />
                      <div>
                        <p className="text-sm font-medium text-app-fg">Performance</p>
                        <p className="text-xs text-app-fg-muted mt-0.5">
                          Prioritise higher performers: agents with better delivery rate and confirmation rate get more orders, even if they already have more pending. Capacity limit still applies.
                        </p>
                      </div>
                    </label>
                    <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-app-border p-4 hover:bg-app-hover/50 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 dark:has-[:checked]:bg-brand-700/20">
                      <input
                        type="radio"
                        name="strategy"
                        value="claim"
                        checked={selectedDispatchStrategy === 'claim'}
                        onChange={() => setSelectedDispatchStrategy('claim')}
                        className="mt-1 text-brand-600 border-app-border focus:ring-brand-500"
                      />
                      <div>
                        <p className="text-sm font-medium text-app-fg">Claim mode</p>
                        <p className="text-xs text-app-fg-muted mt-0.5">
                          Orders are not auto-assigned. They appear in a shared Claim Queue visible to all available agents. First agent to click "Claim" takes the order. Atomic lock prevents double-claiming.
                        </p>
                      </div>
                    </label>
                  </div>

                  {/* Claim cap — only shown when claim mode is selected */}
                  {selectedDispatchStrategy === 'claim' && (
                    <div className="mt-4 p-4 rounded-lg bg-app-hover border border-app-border">
                      <label htmlFor="claim-cap-input" className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">
                        Claim cap (max orders per agent)
                      </label>
                      <p className="text-xs text-app-fg-muted mt-0.5 mb-2">
                        An agent cannot claim new orders if they already have this many unconfirmed orders. Enforced server-side.
                      </p>
                      <div className="flex items-center gap-3">
                        <NumberInput
                          id="claim-cap-input"
                          min={1}
                          max={20}
                          fallbackValue={2}
                          value={localClaimCap}
                          onValueChange={setLocalClaimCap}
                          wrapperClassName="w-24"
                        />
                        <span className="text-xs text-app-fg-muted">orders (1–20)</span>
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-app-fg-muted mt-3">
                    Saved: <strong>{
                      dispatchStrategyFromSettings === 'performance'
                        ? 'Performance'
                        : dispatchStrategyFromSettings === 'claim'
                          ? `Claim (cap: ${claimCapFromSettings})`
                          : dispatchStrategyFromSettings === 'load_balanced'
                            ? 'Load balanced'
                            : 'Manual assignment'
                    }</strong>
                    {hasSystemChanges && ' — you have unsaved changes'}
                  </p>
                </div>
                </Collapsible>
              </div>

              {/* CS order routing — same card shell as VOIP / CS distribution */}
              <div className="card lg:col-span-2">
                <Collapsible
                  contentClassName="mt-4"
                  trigger={
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center">
                        <svg className="w-5 h-5 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
                          />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-app-fg">CS order routing</h3>
                        <p className="text-sm text-app-fg-muted">Cross-branch CS pools when load-balanced or performance dispatch runs</p>
                      </div>
                    </div>
                  }
                >
                <div className="rounded-lg border border-app-border p-4">
                  <p className="text-sm text-app-fg-muted">
                    Send orders from each funnel branch to the right servicing branch, team, or whole-branch closer pool. Reporting stays on
                    the funnel branch; only assignment changes.
                  </p>
                  <p className="mt-3">
                    <Link
                      to="/admin/settings/cs-order-routing"
                      className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
                    >
                      Open CS order routing
                    </Link>
                  </p>
                </div>
                </Collapsible>
              </div>

              {/* Marketing Profitability — target ROAS + green/red threshold */}
              <div className="card lg:col-span-2">
                <Collapsible
                  contentClassName="mt-4"
                  trigger={
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center">
                        <svg className="w-5 h-5 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-app-fg">Marketing profitability</h3>
                        <p className="text-sm text-app-fg-muted">
                          True ROAS = revenue from delivered orders ÷ approved ad spend. Drives the
                          Profitability column on Team Analysis and the ROAS pill on the leaderboard.
                        </p>
                      </div>
                    </div>
                  }
                >
                <div className="rounded-lg border border-app-border p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="profit-target-roas" className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">
                      Target ROAS (score caps at 1.0)
                    </label>
                    <p className="text-xs text-app-fg-muted mt-0.5 mb-2">
                      The True ROAS multiple that maps to a perfect 1.0 profitability score.
                    </p>
                    <div className="flex items-center gap-2">
                      <NumberInput
                        id="profit-target-roas"
                        coerce="decimal"
                        min={0.1}
                        max={50}
                        fallbackValue={3}
                        value={localProfitabilityTarget}
                        onValueChange={setLocalProfitabilityTarget}
                        wrapperClassName="w-28"
                      />
                      <span className="text-xs text-app-fg-muted">x</span>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="profit-green-threshold" className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">
                      Green/red threshold
                    </label>
                    <p className="text-xs text-app-fg-muted mt-0.5 mb-2">
                      At/above this ROAS the buyer is shown in green; below it, red.
                    </p>
                    <div className="flex items-center gap-2">
                      <NumberInput
                        id="profit-green-threshold"
                        coerce="decimal"
                        min={0.1}
                        max={50}
                        fallbackValue={2.5}
                        value={localProfitabilityThreshold}
                        onValueChange={setLocalProfitabilityThreshold}
                        wrapperClassName="w-28"
                      />
                      <span className="text-xs text-app-fg-muted">x</span>
                    </div>
                  </div>
                  <p className="sm:col-span-2 text-xs text-app-fg-muted">
                    Saved: <strong>target {profitabilityTargetSaved}x · green ≥ {profitabilityThresholdSaved}x</strong>
                    {(localProfitabilityTarget !== profitabilityTargetSaved ||
                      localProfitabilityThreshold !== profitabilityThresholdSaved) && ' — you have unsaved changes'}
                  </p>
                </div>
                </Collapsible>
              </div>

              <div className="card lg:col-span-2 pt-4 border-t border-app-border">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={!hasSystemChanges || fetcher.state === 'submitting'}
                  loading={fetcher.state === 'submitting'}
                  loadingText="Saving..."
                  onClick={() => setConfirmSystemOpen(true)}
                >
                  Save system settings
                </Button>
              </div>
            </fetcher.Form>
          ) : (
            <>
              {/* Read-only cards for non–SuperAdmin */}
              <div className="card lg:col-span-2">
                <Collapsible
                  contentClassName="mt-4"
                  trigger={
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center">
                        <svg className="w-5 h-5 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-app-fg">VOIP Integration</h3>
                        <p className="text-sm text-app-fg-muted">Africa's Talking phone-to-phone bridging for CS closers</p>
                      </div>
                    </div>
                  }
                >
                <div className="rounded-lg border border-app-border p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-app-fg">VOIP Calling (Africa&apos;s Talking)</p>
                      <p className="text-xs text-app-fg-muted mt-1">{isVoipEnabled ? 'Enabled' : 'Disabled'}</p>
                    </div>
                    <div
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent opacity-50 cursor-not-allowed ${
                        isVoipEnabled ? 'bg-brand-600' : 'bg-app-border'
                      }`}
                      title="Only Super Admin can change this"
                    >
                      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 ${isVoipEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </div>
                  </div>
                </div>
                </Collapsible>
              </div>
              <div className="card lg:col-span-2">
                <Collapsible
                  contentClassName="mt-4"
                  trigger={
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center">
                        <svg className="w-5 h-5 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 006 3.75h2.25A2.25 2.25 0 0010.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-app-fg">CS order distribution</h3>
                        <p className="text-sm text-app-fg-muted">How new orders are assigned to CS closers when they come in</p>
                      </div>
                    </div>
                  }
                >
                <div className="rounded-lg border border-app-border p-4">
                  <p className="text-sm text-app-fg-muted">
                    Only Super Admin can configure CS order distribution. Current: <strong>{
                      dispatchStrategyFromSettings === 'performance'
                        ? 'Performance'
                        : dispatchStrategyFromSettings === 'claim'
                          ? `Claim (cap: ${claimCapFromSettings})`
                          : dispatchStrategyFromSettings === 'load_balanced'
                            ? 'Load balanced'
                            : 'Manual assignment'
                    }</strong>.
                  </p>
                </div>
                </Collapsible>
              </div>
            </>
          )}
        </div>
      )}

      {/* Org-wide notification email routing — SuperAdmin only */}
      {activeTab === 'orgEmails' && (
        <div className="space-y-6">
          {notificationEmailConfig ? (
            <fetcher.Form method="post" className="space-y-6">
              <input type="hidden" name="intent" value="updateNotificationEmailConfig" />
              <input type="hidden" name="enabledTypes" value={JSON.stringify(enabledTypes)} />

              <div className="card lg:col-span-2">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center">
                    <svg className="w-5 h-5 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-app-fg">Notification Emails</h3>
                    <p className="text-sm text-app-fg-muted">
                      Choose which notification types also send email. Mandatory types always send email.
                    </p>
                  </div>
                </div>

                {/* Mandatory — always on, no toggle */}
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-app-fg-muted mb-3">Always send email (action required)</h4>
                  <div className="space-y-3">
                    {notificationEmailConfig.mandatory.map((item) => (
                      <div
                        key={item.type}
                        className="flex items-center justify-between py-3 px-4 rounded-lg border border-app-border bg-app-hover"
                      >
                        <div>
                          <p className="text-sm font-medium text-app-fg">{item.label}</p>
                          <p className="text-xs text-app-fg-muted mt-0.5">{item.description}</p>
                        </div>
                        <span className="inline-flex items-center gap-1 rounded-full bg-success-50 dark:bg-success-700/20 px-2.5 py-0.5 text-xs font-medium text-success-700 dark:text-success-400">
                          Always on
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Configurable — toggles */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-medium text-app-fg-muted">Configurable (toggle to enable/disable email)</h4>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-app-fg-muted">Toggle all:</span>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          const allOn: Record<string, boolean> = {};
                          notificationEmailConfig.configurable.forEach((c) => { allOn[c.type] = true; });
                          setEnabledTypes(allOn);
                        }}
                      >
                        Enable all
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          const allOff: Record<string, boolean> = {};
                          notificationEmailConfig.configurable.forEach((c) => { allOff[c.type] = false; });
                          setEnabledTypes(allOff);
                        }}
                      >
                        Disable all
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {notificationEmailConfig.configurable.map((item) => (
                      <div
                        key={item.type}
                        className="flex items-center justify-between py-3 px-4 rounded-lg border border-app-border"
                      >
                        <div className="flex-1">
                          <p className="text-sm font-medium text-app-fg">{item.label}</p>
                          <p className="text-xs text-app-fg-muted mt-0.5">{item.description}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setEnabledTypes((prev) => ({
                              ...prev,
                              [item.type]: !prev[item.type],
                            }))
                          }
                          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-surface-900 ${
                            enabledTypes[item.type] ? 'bg-brand-600' : 'bg-app-border'
                          }`}
                          role="switch"
                          aria-checked={enabledTypes[item.type]}
                          aria-label={`Toggle email for ${item.label}`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              enabledTypes[item.type] ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-app-border">
                  <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Saving...">
                    Save notification email settings
                  </Button>
                </div>
              </div>
            </fetcher.Form>
          ) : (
            <div className="card">
              <p className="text-sm text-app-fg-muted">
                Loading notification settings...
              </p>
            </div>
          )}
        </div>
      )}

      {confirmSystemOpen && (
        <Modal
          open
          onClose={() => {
            if (fetcher.state !== 'submitting') setConfirmSystemOpen(false);
          }}
          maxWidth="max-w-md"
          contentClassName="p-6"
        >
          <h3 className="text-lg font-semibold text-app-fg mb-2">Apply system settings?</h3>
          <p className="text-sm text-app-fg-muted mb-4">
            These changes affect everyone in the org — VOIP availability, the CS dispatch strategy,
            and the default app theme. Are you sure you want to apply them now?
          </p>
          <ModalFetcherInlineError
            message={settingsSurface.errorMatchingIntent('updateSystemSettings')}
            className="mb-4"
          />
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirmSystemOpen(false)}
              disabled={fetcher.state === 'submitting'}
            >
              Back
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={fetcher.state === 'submitting'}
              loadingText="Saving..."
              onClick={() => systemFormRef.current?.requestSubmit()}
            >
              Yes, apply
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * Provider picker — separate fetcher so switching submits immediately. Shows every registered
 * provider; unconfigured providers are disabled with a tooltip listing the env vars the admin
 * needs to set on the API server. The active provider's row is highlighted.
 *
 * Submits via intent=`setVoipProvider` to the route action, which calls `voip.setProvider`.
 */
function VoipProviderPicker({
  active,
  providers,
}: {
  active: 'africas_talking';
  providers: Array<{
    name: 'africas_talking';
    displayName: string;
    configured: boolean;
    requiredEnvVars: string[];
    supportsBrowserClient: boolean;
  }>;
}) {
  const switchFetcher = useFetcher<{ success?: boolean; error?: string; message?: string }>();
  const voipSwitchSurface = useFetcherActionSurface(switchFetcher);
  const isSubmitting = switchFetcher.state === 'submitting';
  const submittingProvider = (switchFetcher.formData?.get('provider') as string | null) ?? null;

  useFetcherToast(switchFetcher.data, {
    successMessage: 'VoIP provider updated',
    skipErrorToast: !!voipSwitchSurface.friendlyError,
  });

  return (
    <div className="border-t border-app-border pt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-app-fg-muted mb-2">
        Active VOIP Provider
      </p>
      <div className="space-y-2">
        {providers.map((p) => {
          const isActive = p.name === active;
          const isPending = isSubmitting && submittingProvider === p.name;
          const disabled = !p.configured || isActive || isSubmitting;
          return (
            <div
              key={p.name}
              className={`flex items-center justify-between gap-3 rounded-md border p-3 ${
                isActive
                  ? 'border-brand-300 bg-brand-50/40 dark:border-brand-700 dark:bg-brand-900/10'
                  : 'border-app-border bg-app-elevated'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-app-fg">{p.displayName}</p>
                  {isActive && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 dark:bg-brand-900/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
                      Active
                    </span>
                  )}
                  {!p.configured && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning-100 dark:bg-warning-900/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-700 dark:text-warning-400">
                      Not configured
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-app-fg-muted">
                  {p.supportsBrowserClient
                    ? 'Browser SDK — agent talks via the dashboard.'
                    : "Phone-to-phone — provider rings the agent's phone, then bridges to the customer."}
                </p>
                {/* env-var hint removed — credential setup is documented in the runbook. */}
              </div>
              <switchFetcher.Form method="post">
                <input type="hidden" name="intent" value="setVoipProvider" />
                <input type="hidden" name="provider" value={p.name} />
                <Button
                  type="submit"
                  variant={isActive ? 'secondary' : 'primary'}
                  size="sm"
                  disabled={disabled}
                  loading={isPending}
                  loadingText="Switching…"
                >
                  {isActive ? 'Active' : 'Use this'}
                </Button>
              </switchFetcher.Form>
            </div>
          );
        })}
      </div>
      <ModalFetcherInlineError
        className="mt-2"
        message={voipSwitchSurface.errorMatchingIntent('setVoipProvider')}
      />
      {switchFetcher.data?.success && switchFetcher.data.message && (
        <p className="mt-2 text-xs text-success-700 dark:text-success-400">
          {switchFetcher.data.message}
        </p>
      )}
    </div>
  );
}
