import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useFetcher, useLocation, useSearchParams } from '@remix-run/react';
import { APP_THEME_IDS, CLIENT_UI_CONFIG_KEY } from '@yannis/shared';
import { Button } from '~/components/ui/button';
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
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';

type OrgDefaultTheme = (typeof APP_THEME_IDS)[number];

function parseOrgDefaultTheme(raw: unknown): OrgDefaultTheme {
  if (typeof raw === 'string' && (APP_THEME_IDS as readonly string[]).includes(raw)) {
    return raw as OrgDefaultTheme;
  }
  return 'system';
}

interface SettingsUser {
  name: string;
  email: string;
  role: string;
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

interface SettingsPageProps {
  user: SettingsUser | null;
  systemSettings?: SystemSetting[];
  notificationEmailConfig?: NotificationEmailConfig | null;
}

export type SettingsTabId = 'profile' | 'security' | 'push' | 'system' | 'orgEmails';


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

export function SettingsPage({ user, systemSettings = [], notificationEmailConfig }: SettingsPageProps) {
  const fetcher = useFetcher();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const installAnchorRef = useRef<HTMLDivElement | null>(null);

  // Treat SUPER_ADMIN and ADMIN identically for settings visibility (System + OrgEmails tabs).
  const isSuperAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  const allowedTabs = useMemo((): SettingsTabId[] => {
    return isSuperAdmin ? ['profile', 'security', 'push', 'system', 'orgEmails'] : ['profile', 'security', 'push'];
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
      setSearchParams({ tab: next }, { replace: true });
    },
    [resolveTab, setSearchParams],
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

  // Low-stock threshold setting — admins get a notification when available < threshold.
  const lowStockSetting = systemSettings.find((s) => s.key === 'INVENTORY_LOW_STOCK_CONFIG');
  const lowStockFromSettings = typeof lowStockSetting?.value?.threshold === 'number' ? lowStockSetting.value.threshold : 10;
  const [localLowStockThreshold, setLocalLowStockThreshold] = useState<number>(lowStockFromSettings);

  // Local state for notification email toggles (configurable types only)
  const [enabledTypes, setEnabledTypes] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const initial: Record<string, boolean> = {};
    notificationEmailConfig?.configurable?.forEach((c) => {
      initial[c.type] = c.emailEnabled;
    });
    setEnabledTypes(initial);
  }, [notificationEmailConfig]);

  const actionData = fetcher.data as { error?: string; success?: boolean; message?: string } | undefined;
  const [dismissedError, setDismissedError] = useState(false);
  const [dismissedSuccess, setDismissedSuccess] = useState(false);

  useEffect(() => {
    if (actionData?.error) setDismissedError(false);
    if (actionData?.success) setDismissedSuccess(false);
  }, [actionData?.error, actionData?.success]);

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
    setLocalLowStockThreshold(lowStockFromSettings);
  }, [lowStockFromSettings]);

  const orgDefaultSaved = useMemo(
    () =>
      parseOrgDefaultTheme(
        systemSettings.find((s) => s.key === CLIENT_UI_CONFIG_KEY)?.value?.defaultAppTheme,
      ),
    [systemSettings],
  );
  const [orgDefaultAppTheme, setOrgDefaultAppTheme] = useState<OrgDefaultTheme>(orgDefaultSaved);
  useEffect(() => {
    setOrgDefaultAppTheme(orgDefaultSaved);
  }, [orgDefaultSaved]);

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
    localLowStockThreshold !== lowStockFromSettings ||
    orgDefaultAppTheme !== orgDefaultSaved;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        description="Manage your account and system preferences"
      />

      <Tabs
        value={activeTab}
        onChange={handleTabChange}
        tabs={allowedTabs.map((tab) => ({
          value: tab,
          label: tabLabel(tab),
        }))}
      />

      {actionData?.error && !dismissedError && (
        <PageNotification
          variant="error"
          message={actionData.error}
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

      {activeTab === 'push' && <SettingsPushPanel />}

      {/* System Tab — grouped form: toggle VOIP, CS distribution then submit once */}
      {activeTab === 'system' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {isSuperAdmin ? (
            <fetcher.Form method="post" className="contents">
              <input type="hidden" name="intent" value="updateSystemSettings" />
              <input type="hidden" name="voipEnabled" value={localVoipEnabled ? 'true' : 'false'} />
              <input type="hidden" name="csDispatchStrategy" value={selectedDispatchStrategy} />
              <input type="hidden" name="claimCap" value={String(localClaimCap)} />
              <input type="hidden" name="lowStockThreshold" value={String(localLowStockThreshold)} />
              <input type="hidden" name="defaultAppTheme" value={orgDefaultAppTheme} />

              {/* VOIP Integration */}
              <div className="card lg:col-span-2">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center">
                    <svg className="w-5 h-5 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-app-fg">VOIP Integration</h3>
                    <p className="text-sm text-app-fg-muted">Twilio-powered voice calls for CS agents</p>
                  </div>
                </div>
                <div className="rounded-lg border border-app-border p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <p className="text-sm font-semibold text-app-fg">VOIP Calling (Twilio)</p>
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
                          ? 'Agents use Twilio WebRTC to call customers. Calls are tracked, recorded, and the 15-second confirm gate is enforced. Orders are locked for 15 minutes during calls.'
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
                </div>
              </div>

              {/* CS Order Distribution */}
              <div className="card lg:col-span-2">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center">
                    <svg className="w-5 h-5 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 006 3.75h2.25A2.25 2.25 0 0010.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-app-fg">CS order distribution</h3>
                    <p className="text-sm text-app-fg-muted">How new orders are assigned to CS agents when they come in</p>
                  </div>
                </div>
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
                        <TextInput
                          id="claim-cap-input"
                          type="number"
                          min={1}
                          max={20}
                          value={localClaimCap}
                          onChange={(e) => setLocalClaimCap(Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 2)))}
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
              </div>

              <div className="card lg:col-span-2">
                <h3 className="text-lg font-semibold text-app-fg mb-1">Low-stock alert threshold</h3>
                <p className="text-sm text-app-fg-muted mb-3">
                  When a product's available stock at any location drops below this number, SuperAdmins, Admins, and Stock Managers get an in-app + push notification. Rate-limited to one alert per location per 6 hours.
                </p>
                <div className="flex items-center gap-3">
                  <TextInput
                    id="low-stock-threshold-input"
                    type="number"
                    min={1}
                    max={10000}
                    value={localLowStockThreshold}
                    onChange={(e) => setLocalLowStockThreshold(Math.max(1, Math.min(10000, parseInt(e.target.value, 10) || 10)))}
                    wrapperClassName="w-28"
                  />
                  <span className="text-xs text-app-fg-muted">units</span>
                </div>
                <p className="text-xs text-app-fg-muted mt-3">
                  Saved: <strong>{lowStockFromSettings} units</strong>
                  {hasSystemChanges && localLowStockThreshold !== lowStockFromSettings && ' — you have unsaved changes'}
                </p>
              </div>

              <div className="card lg:col-span-2">
                <h3 className="text-lg font-semibold text-app-fg mb-1">Default appearance</h3>
                <p className="text-sm text-app-fg-muted mb-3">
                  Theme for users who have not set a personal preference. Personal choices in Profile still override this.
                </p>
                <FormSelect
                  id="org-default-theme"
                  label="Workspace default theme"
                  value={orgDefaultAppTheme}
                  onChange={(e) => setOrgDefaultAppTheme(parseOrgDefaultTheme(e.target.value))}
                  wrapperClassName="mt-1 max-w-md"
                  options={APP_THEMES.map((t) => ({ value: t.id, label: t.label }))}
                />
                <p className="text-xs text-app-fg-muted mt-2">
                  Saved default: <strong>{APP_THEMES.find((t) => t.id === orgDefaultSaved)?.label ?? 'System'}</strong>
                </p>
              </div>

              <div className="card lg:col-span-2 pt-4 border-t border-app-border">
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={!hasSystemChanges || fetcher.state === 'submitting'}
                  loading={fetcher.state === 'submitting'}
                  loadingText="Saving..."
                >
                  Save system settings
                </Button>
              </div>
            </fetcher.Form>
          ) : (
            <>
              {/* Read-only cards for non–SuperAdmin */}
              <div className="card lg:col-span-2">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center">
                    <svg className="w-5 h-5 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-app-fg">VOIP Integration</h3>
                    <p className="text-sm text-app-fg-muted">Twilio-powered voice calls for CS agents</p>
                  </div>
                </div>
                <div className="rounded-lg border border-app-border p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-app-fg">VOIP Calling (Twilio)</p>
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
              </div>
              <div className="card lg:col-span-2">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center">
                    <svg className="w-5 h-5 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 006 3.75h2.25A2.25 2.25 0 0010.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-app-fg">CS order distribution</h3>
                    <p className="text-sm text-app-fg-muted">How new orders are assigned to CS agents when they come in</p>
                  </div>
                </div>
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
    </div>
  );
}
