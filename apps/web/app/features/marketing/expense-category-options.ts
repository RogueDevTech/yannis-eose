import type { ExpenseCategory } from './types';

export const EXPENSE_CATEGORY_OPTIONS: Array<{ value: ExpenseCategory; label: string }> = [
  { value: 'AD_SPEND', label: 'Ad Spend' },
  { value: 'AD_ACCOUNT', label: 'Ad Account' },
  { value: 'RECRUITMENT_AD', label: 'Recruitment Ad' },
  { value: 'WHATSAPP_CAMPAIGN', label: 'WhatsApp Campaign' },
  { value: 'UGC_PRODUCTION', label: 'UGC Production' },
];

export const EXPENSE_CATEGORY_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  ...EXPENSE_CATEGORY_OPTIONS,
];
