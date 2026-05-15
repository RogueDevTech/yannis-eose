/**
 * Nigerian bank list used by the staff onboarding bank picker.
 *
 * `code` is the 3-digit CBN sort code (also matches Paystack's `code` field).
 * Picking a bank in the UI auto-fills `payoutBankCode` so Finance never has
 * to type a code by hand. Kept hardcoded rather than fetched from Paystack so
 * the form works offline; if the list ever needs sync we can fall back to
 * `GET https://api.paystack.co/bank`.
 *
 * Ordering: alphabetical for the search dropdown. Add new entries in place.
 */
export interface NigerianBankOption {
  /** Bank display name. */
  name: string;
  /** CBN/Paystack sort code — saved as `users.payout_bank_code`. */
  code: string;
}

export const NIGERIAN_BANKS: ReadonlyArray<NigerianBankOption> = [
  { name: 'Access Bank', code: '044' },
  { name: 'Access Bank (Diamond)', code: '063' },
  { name: 'ALAT by WEMA', code: '035A' },
  { name: 'Carbon (One Finance)', code: '565' },
  { name: 'Citibank Nigeria', code: '023' },
  { name: 'Ecobank Nigeria', code: '050' },
  { name: 'Fairmoney Microfinance Bank', code: '51318' },
  { name: 'FCMB (First City Monument Bank)', code: '214' },
  { name: 'Fidelity Bank', code: '070' },
  { name: 'First Bank of Nigeria', code: '011' },
  { name: 'Globus Bank', code: '00103' },
  { name: 'GTBank (Guaranty Trust Bank)', code: '058' },
  { name: 'Heritage Bank', code: '030' },
  { name: 'Jaiz Bank', code: '301' },
  { name: 'Keystone Bank', code: '082' },
  { name: 'Kuda Bank', code: '50211' },
  { name: 'Lotus Bank', code: '303' },
  { name: 'Moniepoint Microfinance Bank', code: '50515' },
  { name: 'OPay', code: '999992' },
  { name: 'PalmPay', code: '999991' },
  { name: 'Parallex Bank', code: '526' },
  { name: 'Polaris Bank', code: '076' },
  { name: 'PremiumTrust Bank', code: '105' },
  { name: 'Providus Bank', code: '101' },
  { name: 'Rubies (Highstreet) Microfinance', code: '125' },
  { name: 'Sparkle Microfinance Bank', code: '51310' },
  { name: 'Stanbic IBTC Bank', code: '221' },
  { name: 'Standard Chartered Bank', code: '068' },
  { name: 'Sterling Bank', code: '232' },
  { name: 'SunTrust Bank', code: '100' },
  { name: 'TAJ Bank', code: '302' },
  { name: 'Titan Trust Bank', code: '102' },
  { name: 'Union Bank of Nigeria', code: '032' },
  { name: 'United Bank for Africa (UBA)', code: '033' },
  { name: 'Unity Bank', code: '215' },
  { name: 'VFD Microfinance Bank', code: '566' },
  { name: 'Wema Bank', code: '035' },
  { name: 'Zenith Bank', code: '057' },
];

/** Lookup helper for the onboarding service / Finance views. */
export function findBankByName(name: string | null | undefined): NigerianBankOption | null {
  if (!name) return null;
  const trimmed = name.trim().toLowerCase();
  return NIGERIAN_BANKS.find((b) => b.name.toLowerCase() === trimmed) ?? null;
}

export function findBankByCode(code: string | null | undefined): NigerianBankOption | null {
  if (!code) return null;
  const trimmed = code.trim();
  return NIGERIAN_BANKS.find((b) => b.code === trimmed) ?? null;
}
