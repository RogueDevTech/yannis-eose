import { countryForCurrency, phoneRuleForCountry, phoneSpecForCurrency, toInternationalPhone } from '@yannis/shared';
import { TextInput } from './text-input';

interface CustomerPhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Order currency = order country. Drives the example and the dial-code preview. */
  currencyCode: string | null | undefined;
  label?: string;
  required?: boolean;
}

/**
 * Customer phone field for staff-created orders. Previews how the number will
 * dial with the order country's code. The typed value is submitted unchanged:
 * the stored phone feeds the phone hash, so formatting happens at read time.
 */
export function CustomerPhoneInput({
  value,
  onChange,
  currencyCode,
  label = 'Customer phone',
  required = true,
}: CustomerPhoneInputProps) {
  // Shared currencies (XOF, XAF) span several countries: no per-country example
  // or length, and no dial-code preview (toInternationalPhone returns null).
  const spec = phoneSpecForCurrency(currencyCode ?? 'NGN');
  const country = spec ? countryForCurrency(currencyCode ?? 'NGN')?.country ?? null : null;
  const example = spec ? phoneRuleForCountry(country).example : '0XXXXXXXXX';
  // Local form is national length + trunk 0; never shorter than the national number.
  const minDigits = spec ? spec.len : 7;
  const intl = value.trim() ? toInternationalPhone(value, currencyCode) : null;

  const hint = intl
    ? intl.prefixMatchesCountry
      ? `Dials as ${intl.display}`
      : `Dials as ${intl.display}. Check number: not a usual ${country} mobile.`
    : undefined;

  return (
    <TextInput
      type="tel"
      inputMode="tel"
      label={`${label}${required ? ' *' : ''}`}
      required={required}
      minLength={minDigits}
      maxLength={20}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^\d+\-\s()]/g, ''))}
      placeholder={`e.g. ${example}`}
      pattern={`[0-9+\\-\\s()]{${minDigits},20}`}
      title="Enter the local number (starting 0) or the full number with country code"
      hint={hint}
    />
  );
}
