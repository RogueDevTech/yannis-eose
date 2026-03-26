import { useState, useEffect } from 'react';
import { useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { PageNotification } from '~/components/ui/page-notification';
import { Tabs } from '~/components/ui/tabs';
import { usePwaInstall } from '~/hooks/usePwaInstall';
import { ROLE_LABELS } from './types';

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

export function SettingsPage({ user, systemSettings = [], notificationEmailConfig }: SettingsPageProps) {
  const fetcher = useFetcher();
  const [activeTab, setActiveTab] = useState<'profile' | 'security' | 'system' | 'notifications'>('profile');
  const [profileName, setProfileName] = useState(user?.name ?? '');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const { canInstall, install, canPromptInstall, isIosSafariLike } = usePwaInstall();

  useEffect(() => {
    const stored = localStorage.getItem('yannis_theme');
    const dark = stored === 'dark';
    setIsDarkMode(dark);
  }, []);

  const toggleTheme = () => {
    const next = !isDarkMode;
    setIsDarkMode(next);
    if (next) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('yannis_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('yannis_theme', 'light');
    }
  };

  // CS dispatch strategy: derived from settings, local state for form selection
  const csDispatchSetting = systemSettings.find((s) => s.key === 'CS_DISPATCH_STRATEGY');
  const rawStrategy = csDispatchSetting?.value?.strategy;
  const dispatchStrategyFromSettings: 'load_balanced' | 'performance' | 'claim' =
    rawStrategy === 'performance' ? 'performance' : rawStrategy === 'claim' ? 'claim' : 'load_balanced';
  const [selectedDispatchStrategy, setSelectedDispatchStrategy] = useState<'load_balanced' | 'performance' | 'claim'>(dispatchStrategyFromSettings);

  // Claim cap setting
  const claimCapSetting = systemSettings.find((s) => s.key === 'CS_CLAIM_CAP');
  const claimCapFromSettings = typeof claimCapSetting?.value?.cap === 'number' ? claimCapSetting.value.cap : 2;
  const [localClaimCap, setLocalClaimCap] = useState<number>(claimCapFromSettings);

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

  const hasSystemChanges =
    localVoipEnabled !== isVoipEnabled ||
    selectedDispatchStrategy !== dispatchStrategyFromSettings ||
    localClaimCap !== claimCapFromSettings;

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Settings</h1>
        <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
          Manage your account and system preferences
        </p>
      </div>

      <Tabs
        value={activeTab}
        onChange={(v) => setActiveTab(v as typeof activeTab)}
        tabs={(isSuperAdmin
          ? (['profile', 'security', 'system', 'notifications'] as const)
          : (['profile', 'security'] as const)
        ).map((tab) => ({
          value: tab,
          label: tab === 'profile' ? 'Profile' : tab === 'security' ? 'Security' : tab === 'system' ? 'System' : 'Notifications',
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
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white mb-4">Account Information</h3>
            <div className="space-y-4">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 rounded-full bg-brand-100 dark:bg-brand-700/30 flex items-center justify-center">
                  <span className="text-xl font-bold text-brand-600 dark:text-brand-400">
                    {(user?.name ?? '?').split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                  </span>
                </div>
                <div>
                  <p className="text-lg font-semibold text-surface-900 dark:text-white">{user?.name ?? 'Unknown'}</p>
                  <p className="text-sm text-surface-800 dark:text-surface-200">{ROLE_LABELS[user?.role ?? ''] ?? user?.role}</p>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Email</label>
                <p className="text-sm text-surface-900 dark:text-surface-100 mt-1">{user?.email ?? '—'}</p>
              </div>

              <div>
                <label className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Role</label>
                <p className="text-sm text-surface-900 dark:text-surface-100 mt-1">{ROLE_LABELS[user?.role ?? ''] ?? user?.role ?? '—'}</p>
              </div>
            </div>
          </div>

          <fetcher.Form method="post" className="card">
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white mb-4">Edit Profile</h3>
            <input type="hidden" name="intent" value="updateProfile" />
            <div className="space-y-4">
              <div>
                <label htmlFor="name" className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
                  Display Name
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  className="input mt-1"
                  required
                />
              </div>
              <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Saving...">
                Save Changes
              </Button>
            </div>
          </fetcher.Form>

          <div className="card lg:col-span-2 hidden md:block">
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white mb-4">Appearance</h3>
            <div className="flex items-center justify-between rounded-lg border border-surface-200 dark:border-surface-700 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-surface-900 dark:text-white">Theme</p>
                <p className="text-xs text-surface-700 dark:text-surface-300 mt-0.5">
                  {isDarkMode ? 'Dark mode is active' : 'Light mode is active'}
                </p>
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={toggleTheme}>
                {isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              </Button>
            </div>
            <div className="mt-3 flex items-center justify-between rounded-lg border border-surface-200 dark:border-surface-700 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-surface-900 dark:text-white">Install App</p>
                <p className="text-xs text-surface-700 dark:text-surface-300 mt-0.5">
                  {isIosSafariLike
                    ? 'On iPhone/iPad Safari, use Share > Add to Home Screen.'
                    : 'Install Yannis for faster launch and better offline behavior.'}
                </p>
              </div>
              {isIosSafariLike ? (
                <Button type="button" variant="secondary" size="sm" disabled>
                  Use Safari Share
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={!canInstall && !canPromptInstall}
                  onClick={install}
                >
                  Install App
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Security Tab */}
      {activeTab === 'security' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <fetcher.Form method="post" className="card">
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white mb-4">Change Password</h3>
            <input type="hidden" name="intent" value="changePassword" />
            <div className="space-y-4">
              <div>
                <label htmlFor="currentPassword" className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
                  Current Password
                </label>
                <input id="currentPassword" name="currentPassword" type="password" className="input mt-1" required autoComplete="current-password" />
              </div>
              <div>
                <label htmlFor="newPassword" className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
                  New Password
                </label>
                <input id="newPassword" name="newPassword" type="password" className="input mt-1" required minLength={8} autoComplete="new-password" />
              </div>
              <div>
                <label htmlFor="confirmPassword" className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
                  Confirm New Password
                </label>
                <input id="confirmPassword" name="confirmPassword" type="password" className="input mt-1" required minLength={8} autoComplete="new-password" />
              </div>
              <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Updating...">
                Change Password
              </Button>
            </div>
          </fetcher.Form>

        </div>
      )}

      {/* System Tab — grouped form: toggle VOIP, CS distribution then submit once */}
      {activeTab === 'system' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {isSuperAdmin ? (
            <fetcher.Form method="post" className="contents">
              <input type="hidden" name="intent" value="updateSystemSettings" />
              <input type="hidden" name="voipEnabled" value={localVoipEnabled ? 'true' : 'false'} />
              <input type="hidden" name="csDispatchStrategy" value={selectedDispatchStrategy} />
              <input type="hidden" name="claimCap" value={String(localClaimCap)} />

              {/* VOIP Integration */}
              <div className="card lg:col-span-2">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center">
                    <svg className="w-5 h-5 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-surface-900 dark:text-white">VOIP Integration</h3>
                    <p className="text-sm text-surface-800 dark:text-surface-200">Twilio-powered voice calls for CS agents</p>
                  </div>
                </div>
                <div className="rounded-lg border border-surface-200 dark:border-surface-700 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <p className="text-sm font-semibold text-surface-900 dark:text-white">VOIP Calling (Twilio)</p>
                        {localVoipEnabled ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-success-50 dark:bg-success-700/20 px-2.5 py-0.5 text-xs font-medium text-success-700 dark:text-success-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-success-500" /> Enabled
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-surface-100 dark:bg-surface-800 px-2.5 py-0.5 text-xs font-medium text-surface-600 dark:text-surface-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-surface-400" /> Disabled
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-surface-800 dark:text-surface-200 leading-relaxed">
                        {localVoipEnabled
                          ? 'Agents use Twilio WebRTC to call customers. Calls are tracked, recorded, and the 15-second confirm gate is enforced. Orders are locked for 15 minutes during calls.'
                          : 'VOIP is off. Agents will log manual calls. Less control over the call process.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setLocalVoipEnabled(!localVoipEnabled)}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-surface-900 ${
                        localVoipEnabled ? 'bg-brand-600' : 'bg-surface-300 dark:bg-surface-600'
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
                    <h3 className="text-lg font-semibold text-surface-900 dark:text-white">CS order distribution</h3>
                    <p className="text-sm text-surface-800 dark:text-surface-200">How new orders are assigned to CS agents when they come in</p>
                  </div>
                </div>
                <div className="rounded-lg border border-surface-200 dark:border-surface-700 p-4">
                  <div className="space-y-3">
                    <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-surface-200 dark:border-surface-700 p-4 hover:bg-surface-50 dark:hover:bg-surface-800/50 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 dark:has-[:checked]:bg-brand-700/20">
                      <input
                        type="radio"
                        name="strategy"
                        value="load_balanced"
                        checked={selectedDispatchStrategy === 'load_balanced'}
                        onChange={() => setSelectedDispatchStrategy('load_balanced')}
                        className="mt-1 text-brand-600 border-surface-300 focus:ring-brand-500"
                      />
                      <div>
                        <p className="text-sm font-medium text-surface-900 dark:text-white">Load balanced</p>
                        <p className="text-xs text-surface-800 dark:text-surface-200 mt-0.5">
                          Distribute by current workload: agents with fewer pending orders get new orders first. Tie-break: most idle.
                        </p>
                      </div>
                    </label>
                    <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-surface-200 dark:border-surface-700 p-4 hover:bg-surface-50 dark:hover:bg-surface-800/50 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 dark:has-[:checked]:bg-brand-700/20">
                      <input
                        type="radio"
                        name="strategy"
                        value="performance"
                        checked={selectedDispatchStrategy === 'performance'}
                        onChange={() => setSelectedDispatchStrategy('performance')}
                        className="mt-1 text-brand-600 border-surface-300 focus:ring-brand-500"
                      />
                      <div>
                        <p className="text-sm font-medium text-surface-900 dark:text-white">Performance</p>
                        <p className="text-xs text-surface-800 dark:text-surface-200 mt-0.5">
                          Prioritise higher performers: agents with better delivery rate and confirmation rate get more orders, even if they already have more pending. Capacity limit still applies.
                        </p>
                      </div>
                    </label>
                    <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-surface-200 dark:border-surface-700 p-4 hover:bg-surface-50 dark:hover:bg-surface-800/50 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 dark:has-[:checked]:bg-brand-700/20">
                      <input
                        type="radio"
                        name="strategy"
                        value="claim"
                        checked={selectedDispatchStrategy === 'claim'}
                        onChange={() => setSelectedDispatchStrategy('claim')}
                        className="mt-1 text-brand-600 border-surface-300 focus:ring-brand-500"
                      />
                      <div>
                        <p className="text-sm font-medium text-surface-900 dark:text-white">Claim mode</p>
                        <p className="text-xs text-surface-800 dark:text-surface-200 mt-0.5">
                          Orders are not auto-assigned. They appear in a shared Claim Queue visible to all available agents. First agent to click "Claim" takes the order. Atomic lock prevents double-claiming.
                        </p>
                      </div>
                    </label>
                  </div>

                  {/* Claim cap — only shown when claim mode is selected */}
                  {selectedDispatchStrategy === 'claim' && (
                    <div className="mt-4 p-4 rounded-lg bg-surface-50 dark:bg-surface-800/50 border border-surface-200 dark:border-surface-700">
                      <label htmlFor="claim-cap-input" className="text-xs font-medium text-surface-700 dark:text-surface-300 uppercase tracking-wider">
                        Claim cap (max orders per agent)
                      </label>
                      <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5 mb-2">
                        An agent cannot claim new orders if they already have this many unconfirmed orders. Enforced server-side.
                      </p>
                      <div className="flex items-center gap-3">
                        <input
                          id="claim-cap-input"
                          type="number"
                          min={1}
                          max={20}
                          value={localClaimCap}
                          onChange={(e) => setLocalClaimCap(Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 2)))}
                          className="input w-24"
                        />
                        <span className="text-xs text-surface-500 dark:text-surface-400">orders (1–20)</span>
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-surface-600 dark:text-surface-400 mt-3">
                    Saved: <strong>{dispatchStrategyFromSettings === 'performance' ? 'Performance' : dispatchStrategyFromSettings === 'claim' ? `Claim (cap: ${claimCapFromSettings})` : 'Load balanced'}</strong>
                    {hasSystemChanges && ' — you have unsaved changes'}
                  </p>
                </div>
              </div>

              <div className="card lg:col-span-2 pt-4 border-t border-surface-200 dark:border-surface-700">
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
                    <h3 className="text-lg font-semibold text-surface-900 dark:text-white">VOIP Integration</h3>
                    <p className="text-sm text-surface-800 dark:text-surface-200">Twilio-powered voice calls for CS agents</p>
                  </div>
                </div>
                <div className="rounded-lg border border-surface-200 dark:border-surface-700 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-surface-900 dark:text-white">VOIP Calling (Twilio)</p>
                      <p className="text-xs text-surface-800 dark:text-surface-200 mt-1">{isVoipEnabled ? 'Enabled' : 'Disabled'}</p>
                    </div>
                    <div
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent opacity-50 cursor-not-allowed ${
                        isVoipEnabled ? 'bg-brand-600' : 'bg-surface-300 dark:bg-surface-600'
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
                    <h3 className="text-lg font-semibold text-surface-900 dark:text-white">CS order distribution</h3>
                    <p className="text-sm text-surface-800 dark:text-surface-200">How new orders are assigned to CS agents when they come in</p>
                  </div>
                </div>
                <div className="rounded-lg border border-surface-200 dark:border-surface-700 p-4">
                  <p className="text-sm text-surface-800 dark:text-surface-200">
                    Only Super Admin can configure CS order distribution. Current: <strong>{dispatchStrategyFromSettings === 'performance' ? 'Performance' : dispatchStrategyFromSettings === 'claim' ? `Claim (cap: ${claimCapFromSettings})` : 'Load balanced'}</strong>.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Notifications Tab — SuperAdmin only */}
      {activeTab === 'notifications' && (
        <div className="space-y-6">
          {!isSuperAdmin ? (
            <div className="card">
              <p className="text-sm text-surface-800 dark:text-surface-200">
                Only Super Admin can configure notification email settings.
              </p>
            </div>
          ) : notificationEmailConfig ? (
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
                    <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Notification Emails</h3>
                    <p className="text-sm text-surface-800 dark:text-surface-200">
                      Choose which notification types also send email. Mandatory types always send email.
                    </p>
                  </div>
                </div>

                {/* Mandatory — always on, no toggle */}
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-surface-700 dark:text-surface-300 mb-3">Always send email (action required)</h4>
                  <div className="space-y-3">
                    {notificationEmailConfig.mandatory.map((item) => (
                      <div
                        key={item.type}
                        className="flex items-center justify-between py-3 px-4 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50"
                      >
                        <div>
                          <p className="text-sm font-medium text-surface-900 dark:text-white">{item.label}</p>
                          <p className="text-xs text-surface-600 dark:text-surface-200 mt-0.5">{item.description}</p>
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
                    <h4 className="text-sm font-medium text-surface-700 dark:text-surface-300">Configurable (toggle to enable/disable email)</h4>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-surface-500 dark:text-surface-400">Toggle all:</span>
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
                        className="flex items-center justify-between py-3 px-4 rounded-lg border border-surface-200 dark:border-surface-700"
                      >
                        <div className="flex-1">
                          <p className="text-sm font-medium text-surface-900 dark:text-white">{item.label}</p>
                          <p className="text-xs text-surface-600 dark:text-surface-200 mt-0.5">{item.description}</p>
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
                            enabledTypes[item.type] ? 'bg-brand-600' : 'bg-surface-300 dark:bg-surface-600'
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

                <div className="mt-6 pt-4 border-t border-surface-200 dark:border-surface-700">
                  <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Saving...">
                    Save notification email settings
                  </Button>
                </div>
              </div>
            </fetcher.Form>
          ) : (
            <div className="card">
              <p className="text-sm text-surface-800 dark:text-surface-200">
                Loading notification settings...
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
