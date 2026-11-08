/**
 * Which countries a user may build marketing forms for (owner request 2026-11-08:
 * "Media buyer should only be able to create form for the countries they have
 * access to").
 *
 * A Media Buyer still SEES every country's data (canViewAllCountries), but the
 * country a form sells into follows their assignment in `user_countries`
 * ("Countries this user can access" on the user editor), per company.
 *
 * Shared by the API guard (authoritative) and the form builder (country list).
 *
 * @returns `null` when the user may build forms for any country; otherwise the
 *          uppercase currency codes they are assigned. An EMPTY array means "no
 *          assignment": the caller treats it as the company's base country only,
 *          matching how an unassigned user is scoped everywhere else.
 */
export function formCountryCurrencyCodes(user: {
  role?: string | null;
  currencyCodes?: string[] | null;
}): string[] | null {
  if (user.role !== 'MEDIA_BUYER') return null;
  return [
    ...new Set((user.currencyCodes ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean)),
  ];
}
