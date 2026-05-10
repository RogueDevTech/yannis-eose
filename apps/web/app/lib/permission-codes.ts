/**
 * Must match `packages/shared/src/rbac/permission-codes.ts`. Session `/auth/me`
 * stores canonical codes (e.g. `marketing.campaigns.manage`); loaders pass stable
 * catalog keys (e.g. `marketing.campaigns`). The shared mapper aligns both — the
 * old web-only duplicate omitted `marketing.campaigns`, which denied Marketing →
 * Forms for Media Buyers who **do** hold that capability in the catalog.
 */
export { canonicalPermissionCode } from '@yannis/shared';

/**
 * Acronyms that should display as ALL-CAPS rather than Title Case.
 * Anything not in this set gets the regular "first-letter-uppercase, rest
 * lowercase" treatment so codes don't look shouty.
 */
const PERMISSION_DISPLAY_ACRONYMS = new Set([
  'cs', 'hr', 'voip', 'tpl', 'sms', 'ceo', 'cpa', 'roas',
  'rbac', 'pwa', 'ui', 'ux', 'api', 'kyc', 'cogs', 'mb', 'pdf',
]);

/**
 * Convert a dotted permission code into a readable label.
 *   audit.logs.view              → "Audit logs view"
 *   marketing.adSpend.approve    → "Marketing ad spend approve"
 *   finance.cash_remittance.create → "Finance cash remittance create"
 *   cs.dashboard                 → "CS dashboard"
 *
 * Splits on dots / underscores, breaks camelCase, lowercases, then
 * sentence-cases (only the first word is capitalized; subsequent words stay
 * lowercase unless they're a known acronym). Keep the canonical dotted code
 * around as the source-of-truth identifier in tooltips / debug surfaces.
 */
export function formatPermissionCode(code: string): string {
  const words = code
    .replace(/[._]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  return words
    .map((word, index) => {
      if (PERMISSION_DISPLAY_ACRONYMS.has(word)) return word.toUpperCase();
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1);
      return word;
    })
    .join(' ');
}

/**
 * Convert the leading segment of a permission code (the "group key" used in
 * the matrix UI) into a readable section heading.
 *   audit  → "Audit"
 *   cs     → "CS"
 *   hr     → "HR"
 *   marketing → "Marketing"
 */
export function formatPermissionGroup(key: string): string {
  if (PERMISSION_DISPLAY_ACRONYMS.has(key.toLowerCase())) return key.toUpperCase();
  return formatPermissionCode(key);
}
