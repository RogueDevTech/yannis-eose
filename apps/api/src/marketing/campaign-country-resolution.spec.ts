import { describe, it, expect } from 'vitest';

/**
 * The public form's starting country.
 *
 * `formConfig.deliveryCountry` lives inside a JSONB blob that the campaign
 * editor rewrites wholesale, so a save from a UI holding a stale copy silently
 * drops the key. That happened in prod: a backfill of 414 campaigns lost 3
 * within four days, and a campaign with no country falls through to
 * phoneRuleForCountry('')'s permissive international rule — the public form
 * then accepts almost any digits as a phone number.
 *
 * getPublicCampaign therefore DERIVES the country from the company's default
 * currency when the stored key is absent. These tests pin that precedence.
 *
 * Mirrors MarketingService.resolveCampaignCountry.
 */
function resolveCampaignCountry(
  storedCountry: string | null | undefined,
  defaultCurrencyCountry: string | null | undefined,
): string | undefined {
  const stored = typeof storedCountry === 'string' ? storedCountry.trim() : '';
  if (stored) return stored;
  const derived = defaultCurrencyCountry?.trim();
  return derived ? derived : undefined;
}

describe('campaign country resolution', () => {
  it('uses the stored country when present', () => {
    expect(resolveCampaignCountry('Ghana', 'Nigeria')).toBe('Ghana');
  });

  it('derives from the default currency when the key was wiped', () => {
    expect(resolveCampaignCountry(null, 'Nigeria')).toBe('Nigeria');
  });

  it('derives when the key is present but empty', () => {
    expect(resolveCampaignCountry('', 'Nigeria')).toBe('Nigeria');
  });

  it('derives when the stored value is only whitespace', () => {
    expect(resolveCampaignCountry('   ', 'Nigeria')).toBe('Nigeria');
  });

  it('trims a padded stored value rather than passing it through', () => {
    expect(resolveCampaignCountry('  Nigeria  ', 'Ghana')).toBe('Nigeria');
  });

  it('returns undefined when neither is available, never an empty string', () => {
    // '' would be indistinguishable from "no country" at the worker and would
    // re-enable the permissive international rule.
    expect(resolveCampaignCountry(null, null)).toBeUndefined();
    expect(resolveCampaignCountry('', '')).toBeUndefined();
  });

  it('never lets a non-string stored value win', () => {
    expect(resolveCampaignCountry(undefined, 'Zambia')).toBe('Zambia');
  });
});
