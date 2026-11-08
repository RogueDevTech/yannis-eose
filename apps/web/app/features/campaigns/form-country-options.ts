import type { CurrencyCatalogEntry } from '~/contexts/currencies-catalog-context';

/**
 * Countries the form builder offers. `allowedCodes` comes from
 * `formCountryCurrencyCodes(user)` (shared): null = every configured country,
 * [] = base country only, otherwise the user's assigned countries. The API
 * enforces the same rule; this only keeps the picker honest.
 *
 * `keep` is the form's saved country (edit page): it stays listed even after a
 * revoke, so an untouched form can still be saved.
 */
export function formCountryOptions(
  configuredCountries: string[],
  currencies: CurrencyCatalogEntry[],
  allowedCodes: string[] | null | undefined,
  keep?: string,
): string[] {
  if (allowedCodes == null) return configuredCountries;
  const base = currencies.find((c) => c.isDefault && c.active) ?? currencies.find((c) => c.isDefault);
  const permitted = new Set(
    (allowedCodes.length > 0 ? allowedCodes : [base?.code ?? 'NGN']).map((c) => c.toUpperCase()),
  );
  const out = configuredCountries.filter((country) =>
    currencies.some(
      (c) =>
        c.active &&
        c.countryName.toLowerCase() === country.toLowerCase() &&
        permitted.has(c.code.toUpperCase()),
    ),
  );
  if (keep && !out.some((c) => c.toLowerCase() === keep.toLowerCase())) out.push(keep);
  return out;
}
