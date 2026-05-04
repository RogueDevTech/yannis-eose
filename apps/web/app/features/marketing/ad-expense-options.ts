import type { AdPlatform } from './types';

/**
 * Platform options shared between the Add Expense form and the Ad Spend
 * detail/list views. Lives in its own module (not co-located with
 * `AddExpenseForm`) so Vite Fast Refresh can hot-reload the form component
 * without invalidating consumers of this constant — Fast Refresh requires
 * modules to export only React components.
 */
export const AD_EXPENSE_PLATFORM_OPTIONS: Array<{ value: AdPlatform; label: string }> = [
  { value: 'FACEBOOK', label: 'Facebook' },
  { value: 'TIKTOK', label: 'TikTok' },
  { value: 'GOOGLE', label: 'Google' },
  { value: 'OTHER', label: 'Other' },
];
