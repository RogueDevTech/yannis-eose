/**
 * African countries + their national currencies. Powers the "Add currency"
 * config dropdown: pick a Country → the Currency code + Symbol auto-fill.
 *
 * Focused on Africa first (owner directive). `code` is ISO 4217, `symbol` the
 * common display symbol, `precision` the standard minor-unit count.
 */
export interface CountryCurrency {
  /** Country name (label + stored `country_name`). */
  country: string;
  /** ISO 4217 currency code, e.g. 'NGN', 'GHS'. */
  code: string;
  /** Display symbol, e.g. '₦', 'GH₵'. */
  symbol: string;
  /** Minor-unit decimal places. */
  precision: number;
  /** Emoji flag (regional-indicator pair) for the country. */
  flag: string;
}

export const AFRICAN_COUNTRY_CURRENCIES: ReadonlyArray<CountryCurrency> = [
  // Frequently-used first (Nigeria, Ghana, then the rest of the continent A→Z).
  { country: 'Nigeria', code: 'NGN', symbol: '₦', precision: 2, flag: '🇳🇬' },
  { country: 'Ghana', code: 'GHS', symbol: 'GH₵', precision: 2, flag: '🇬🇭' },
  { country: 'Algeria', code: 'DZD', symbol: 'DA', precision: 2, flag: '🇩🇿' },
  { country: 'Angola', code: 'AOA', symbol: 'Kz', precision: 2, flag: '🇦🇴' },
  { country: 'Benin', code: 'XOF', symbol: 'CFA', precision: 0, flag: '🇧🇯' },
  { country: 'Botswana', code: 'BWP', symbol: 'P', precision: 2, flag: '🇧🇼' },
  { country: 'Burkina Faso', code: 'XOF', symbol: 'CFA', precision: 0, flag: '🇧🇫' },
  { country: 'Burundi', code: 'BIF', symbol: 'FBu', precision: 0, flag: '🇧🇮' },
  { country: 'Cabo Verde', code: 'CVE', symbol: '$', precision: 2, flag: '🇨🇻' },
  { country: 'Cameroon', code: 'XAF', symbol: 'FCFA', precision: 0, flag: '🇨🇲' },
  { country: 'Central African Republic', code: 'XAF', symbol: 'FCFA', precision: 0, flag: '🇨🇫' },
  { country: 'Chad', code: 'XAF', symbol: 'FCFA', precision: 0, flag: '🇹🇩' },
  { country: 'Comoros', code: 'KMF', symbol: 'CF', precision: 0, flag: '🇰🇲' },
  { country: 'Congo (Brazzaville)', code: 'XAF', symbol: 'FCFA', precision: 0, flag: '🇨🇬' },
  { country: 'Congo (Kinshasa)', code: 'CDF', symbol: 'FC', precision: 2, flag: '🇨🇩' },
  { country: "Côte d'Ivoire", code: 'XOF', symbol: 'CFA', precision: 0, flag: '🇨🇮' },
  { country: 'Djibouti', code: 'DJF', symbol: 'Fdj', precision: 0, flag: '🇩🇯' },
  { country: 'Egypt', code: 'EGP', symbol: 'E£', precision: 2, flag: '🇪🇬' },
  { country: 'Equatorial Guinea', code: 'XAF', symbol: 'FCFA', precision: 0, flag: '🇬🇶' },
  { country: 'Eritrea', code: 'ERN', symbol: 'Nfk', precision: 2, flag: '🇪🇷' },
  { country: 'Eswatini', code: 'SZL', symbol: 'E', precision: 2, flag: '🇸🇿' },
  { country: 'Ethiopia', code: 'ETB', symbol: 'Br', precision: 2, flag: '🇪🇹' },
  { country: 'Gabon', code: 'XAF', symbol: 'FCFA', precision: 0, flag: '🇬🇦' },
  { country: 'Gambia', code: 'GMD', symbol: 'D', precision: 2, flag: '🇬🇲' },
  { country: 'Guinea', code: 'GNF', symbol: 'FG', precision: 0, flag: '🇬🇳' },
  { country: 'Guinea-Bissau', code: 'XOF', symbol: 'CFA', precision: 0, flag: '🇬🇼' },
  { country: 'Kenya', code: 'KES', symbol: 'KSh', precision: 2, flag: '🇰🇪' },
  { country: 'Lesotho', code: 'LSL', symbol: 'L', precision: 2, flag: '🇱🇸' },
  { country: 'Liberia', code: 'LRD', symbol: 'L$', precision: 2, flag: '🇱🇷' },
  { country: 'Libya', code: 'LYD', symbol: 'LD', precision: 3, flag: '🇱🇾' },
  { country: 'Madagascar', code: 'MGA', symbol: 'Ar', precision: 2, flag: '🇲🇬' },
  { country: 'Malawi', code: 'MWK', symbol: 'MK', precision: 2, flag: '🇲🇼' },
  { country: 'Mali', code: 'XOF', symbol: 'CFA', precision: 0, flag: '🇲🇱' },
  { country: 'Mauritania', code: 'MRU', symbol: 'UM', precision: 2, flag: '🇲🇷' },
  { country: 'Mauritius', code: 'MUR', symbol: '₨', precision: 2, flag: '🇲🇺' },
  { country: 'Morocco', code: 'MAD', symbol: 'DH', precision: 2, flag: '🇲🇦' },
  { country: 'Mozambique', code: 'MZN', symbol: 'MT', precision: 2, flag: '🇲🇿' },
  { country: 'Namibia', code: 'NAD', symbol: 'N$', precision: 2, flag: '🇳🇦' },
  { country: 'Niger', code: 'XOF', symbol: 'CFA', precision: 0, flag: '🇳🇪' },
  { country: 'Rwanda', code: 'RWF', symbol: 'FRw', precision: 0, flag: '🇷🇼' },
  { country: 'São Tomé and Príncipe', code: 'STN', symbol: 'Db', precision: 2, flag: '🇸🇹' },
  { country: 'Senegal', code: 'XOF', symbol: 'CFA', precision: 0, flag: '🇸🇳' },
  { country: 'Seychelles', code: 'SCR', symbol: '₨', precision: 2, flag: '🇸🇨' },
  { country: 'Sierra Leone', code: 'SLE', symbol: 'Le', precision: 2, flag: '🇸🇱' },
  { country: 'Somalia', code: 'SOS', symbol: 'Sh', precision: 2, flag: '🇸🇴' },
  { country: 'South Africa', code: 'ZAR', symbol: 'R', precision: 2, flag: '🇿🇦' },
  { country: 'South Sudan', code: 'SSP', symbol: '£', precision: 2, flag: '🇸🇸' },
  { country: 'Sudan', code: 'SDG', symbol: 'ج.س', precision: 2, flag: '🇸🇩' },
  { country: 'Tanzania', code: 'TZS', symbol: 'TSh', precision: 2, flag: '🇹🇿' },
  { country: 'Togo', code: 'XOF', symbol: 'CFA', precision: 0, flag: '🇹🇬' },
  { country: 'Tunisia', code: 'TND', symbol: 'DT', precision: 3, flag: '🇹🇳' },
  { country: 'Uganda', code: 'UGX', symbol: 'USh', precision: 0, flag: '🇺🇬' },
  { country: 'Zambia', code: 'ZMW', symbol: 'ZK', precision: 2, flag: '🇿🇲' },
  { country: 'Zimbabwe', code: 'ZWL', symbol: 'Z$', precision: 2, flag: '🇿🇼' },
];

/** Distinct currency codes across the catalog (deduped, for a currency dropdown). */
export const AFRICAN_CURRENCY_CODES: ReadonlyArray<{ code: string; symbol: string; precision: number }> = (() => {
  const seen = new Map<string, { code: string; symbol: string; precision: number }>();
  for (const c of AFRICAN_COUNTRY_CURRENCIES) {
    if (!seen.has(c.code)) seen.set(c.code, { code: c.code, symbol: c.symbol, precision: c.precision });
  }
  return [...seen.values()];
})();

/** Look up the default currency for a country name. */
export function currencyForCountry(country: string): CountryCurrency | undefined {
  return AFRICAN_COUNTRY_CURRENCIES.find((c) => c.country === country);
}

/** Look up the country config for a currency code (first match). */
export function countryForCurrency(code: string): CountryCurrency | undefined {
  const up = code.toUpperCase();
  return AFRICAN_COUNTRY_CURRENCIES.find((c) => c.code.toUpperCase() === up);
}

/** Emoji flag for a country name, or an empty string when unknown. */
export function flagForCountry(country: string | null | undefined): string {
  if (!country) return '';
  return AFRICAN_COUNTRY_CURRENCIES.find((c) => c.country === country)?.flag ?? '';
}

/**
 * Catalog-free display symbol for a currency code, for server-side / shared paths
 * that render money without the live currencies catalog (clipboard summaries, push
 * notifications). Falls back to the uppercased code when the currency is unknown.
 */
export function symbolForCurrencyCode(code?: string | null): string {
  const up = (code || 'NGN').toUpperCase();
  if (up === 'NGN') return '₦';
  if (up === 'USD') return '$';
  return AFRICAN_CURRENCY_CODES.find((c) => c.code === up)?.symbol ?? up;
}

/**
 * Curated administrative regions (states / provinces / regions) per country, for
 * the public form's "Delivery State" dropdown. When a form's country changes,
 * this list pre-fills the delivery options. The Media Buyer can still edit them.
 * Keyed by the exact country name used in AFRICAN_COUNTRY_CURRENCIES.
 */
export const COUNTRY_REGIONS: Readonly<Record<string, ReadonlyArray<string>>> = {
  Nigeria: [
    'Lagos', 'Abuja (FCT)', 'Rivers', 'Oyo', 'Kano', 'Delta', 'Edo', 'Ogun', 'Anambra', 'Kaduna',
    'Enugu', 'Imo', 'Abia', 'Akwa Ibom', 'Cross River', 'Plateau', 'Ondo', 'Osun', 'Ekiti', 'Kwara',
    'Benue', 'Nasarawa', 'Niger', 'Kogi', 'Bauchi', 'Borno', 'Gombe', 'Adamawa', 'Taraba', 'Yobe',
    'Sokoto', 'Kebbi', 'Zamfara', 'Katsina', 'Jigawa', 'Bayelsa', 'Ebonyi', 'Kwara',
  ],
  Ghana: [
    'Greater Accra', 'Ashanti', 'Western', 'Central', 'Eastern', 'Volta', 'Northern', 'Upper East',
    'Upper West', 'Bono', 'Bono East', 'Ahafo', 'Western North', 'Oti', 'Savannah', 'North East',
  ],
  Kenya: [
    'Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret', 'Kiambu', 'Machakos', 'Kajiado', 'Uasin Gishu',
    'Meru', 'Nyeri', 'Kakamega', 'Kilifi', 'Kisii', 'Bungoma', 'Kericho', 'Thika',
  ],
  Tanzania: [
    'Dar es Salaam', 'Arusha', 'Mwanza', 'Dodoma', 'Mbeya', 'Morogoro', 'Tanga', 'Kilimanjaro',
    'Zanzibar', 'Tabora', 'Kigoma', 'Mtwara', 'Iringa', 'Shinyanga',
  ],
  Uganda: [
    'Central (Kampala)', 'Wakiso', 'Mukono', 'Jinja', 'Gulu', 'Mbarara', 'Mbale', 'Masaka', 'Lira',
    'Fort Portal', 'Arua', 'Soroti', 'Hoima',
  ],
  'South Africa': [
    'Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape', 'Free State', 'Limpopo', 'Mpumalanga',
    'North West', 'Northern Cape',
  ],
  Rwanda: ['Kigali', 'Eastern Province', 'Northern Province', 'Southern Province', 'Western Province'],
  Zambia: [
    'Lusaka', 'Copperbelt', 'Central', 'Eastern', 'Luapula', 'Muchinga', 'Northern', 'North-Western',
    'Southern', 'Western',
  ],
};

/** Region list for a country, or an empty array when we don't have one. */
export function regionsForCountry(country: string): ReadonlyArray<string> {
  return COUNTRY_REGIONS[country] ?? [];
}

/**
 * Per-country phone rules for the public order form. Drives the phone input's
 * placeholder, HTML `pattern`, and the client/server validation so a Ghana form
 * accepts Ghanaian numbers (not Nigerian).
 *
 * `pattern` is a JS/HTML5 regex SOURCE (no delimiters) matching the LOCAL and
 * international forms a customer might type. `example` seeds the placeholder and
 * the error hint. `dialCode` is the country calling code (digits, no '+').
 *
 * IMPORTANT (edge-freeze rule): the server never HARD-rejects on these — it uses
 * a loose length check and stamps the number (never a 4xx on intake). These
 * strict patterns are the CLIENT-side nudge only.
 */
export interface CountryPhoneRule {
  country: string;
  /** Calling code digits, no '+', e.g. '234', '233'. */
  dialCode: string;
  /** HTML5 pattern SOURCE (no slashes) accepting local + international forms. */
  pattern: string;
  /** Example local number for the placeholder + hint, e.g. '08012345678'. */
  example: string;
  /** Example international number for the hint, e.g. '+2348012345678'. */
  exampleIntl: string;
}

export const COUNTRY_PHONE_RULES: Readonly<Record<string, CountryPhoneRule>> = {
  Nigeria: {
    country: 'Nigeria',
    dialCode: '234',
    // Local 0[789]XXXXXXXXX (11) or +234[789]XXXXXXXXX. Unchanged from the
    // legacy hardcoded rule so Nigerian forms behave byte-for-byte as before.
    pattern: '(0[789][0-9]{9}|\\+234[789][0-9]{9})',
    example: '08012345678',
    exampleIntl: '+2348012345678',
  },
  Ghana: {
    country: 'Ghana',
    dialCode: '233',
    // Ghana mobile: local 0XXXXXXXXX (10 digits) or +233XXXXXXXXX. Accept any
    // leading mobile digit run rather than over-constraining networks.
    pattern: '(0[2-9][0-9]{8}|\\+233[2-9][0-9]{8})',
    example: '0241234567',
    exampleIntl: '+233241234567',
  },
};

/**
 * Phone rule for a country, defaulting to a permissive international pattern for
 * countries we haven't curated yet (never blocks a legitimate order).
 */
export function phoneRuleForCountry(country: string | null | undefined): CountryPhoneRule {
  if (country && COUNTRY_PHONE_RULES[country]) return COUNTRY_PHONE_RULES[country]!;
  // Permissive fallback: 7–15 digits, optional leading '+'. Matches E.164-ish
  // input without hard-coding a country — keeps unknown-country forms working.
  return {
    country: country ?? 'International',
    dialCode: '',
    pattern: '(\\+?[0-9]{7,15})',
    example: '+1234567890',
    exampleIntl: '+1234567890',
  };
}

/**
 * Local-number lengths that map a leading-0 national number to a dial code, so
 * the phone HASH is identical whether the customer typed local (0…) or
 * international (+…). Keyed by the FULL local length INCLUDING the leading 0.
 *
 * 🛑 BACKWARD-COMPAT: the 11→234 (Nigeria) mapping MUST stay exactly as it was
 * historically, or every existing Nigerian phone hash breaks (dedup, target
 * groups, follow-ups). New entries only ADD countries with non-conflicting
 * local lengths. Nigeria national = 11 digits (0 + 10); Ghana = 10 (0 + 9).
 */
const LOCAL_LEN_TO_DIALCODE: Readonly<Record<number, string>> = {
  11: '234', // Nigeria (0XXXXXXXXXX → 234XXXXXXXXXX) — legacy, do not change.
  10: '233', // Ghana   (0XXXXXXXXX  → 233XXXXXXXXX)
};

/**
 * Canonical digit string for hashing a phone number. Maps a local `0…` number
 * to `dialCode + rest` so the same physical phone hashes identically regardless
 * of local vs international entry. MUST be identical across every hashPhone site
 * (edge worker, OrdersService, TargetGroupService, seed) — call THIS everywhere.
 *
 * Nigerian numbers are byte-for-byte unchanged from the legacy inline logic.
 */
export function normalizePhoneForHash(phone: string): string {
  let digits = (phone || '').replace(/\D/g, '');
  const dial = digits.startsWith('0') ? LOCAL_LEN_TO_DIALCODE[digits.length] : undefined;
  if (dial) digits = dial + digits.slice(1);
  return digits;
}

/** Dial codes we know how to expand (derived from LOCAL_LEN_TO_DIALCODE). */
const KNOWN_DIAL_CODES: ReadonlyArray<{ len: number; dial: string }> = Object.entries(
  LOCAL_LEN_TO_DIALCODE,
).map(([len, dial]) => ({ len: Number(len), dial }));

/**
 * Local ↔ international digit-run variants for a `customer_phone` ILIKE search,
 * so searching a Ghanaian (or Nigerian) number in either form finds the same
 * rows. Country-aware generalization of the legacy Nigerian-only expansion.
 *
 * Input is a bare digit run (no '+'). Returns the input plus any equivalent
 * forms: local `0…` ⇄ international `dialCode…`, keyed off the national length.
 */
export function phoneSearchVariants(digitRun: string): string[] {
  const runs = new Set<string>([digitRun]);
  // Local 0… → dialCode… (uses the same length map as the hash).
  if (digitRun.startsWith('0')) {
    const dial = LOCAL_LEN_TO_DIALCODE[digitRun.length];
    if (dial) runs.add(`${dial}${digitRun.slice(1)}`);
  }
  // International dialCode… → local 0… (for each known dial code).
  for (const { len, dial } of KNOWN_DIAL_CODES) {
    // The international form is dial (3) + national (len-1) digits.
    if (digitRun.startsWith(dial) && digitRun.length === dial.length + (len - 1)) {
      runs.add(`0${digitRun.slice(dial.length)}`);
    }
  }
  return [...runs];
}
