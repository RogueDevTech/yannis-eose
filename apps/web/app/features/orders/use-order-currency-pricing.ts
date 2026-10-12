import { useEffect, useState } from 'react';
import { countryForCurrency, regionsForCountry } from '@yannis/shared';
import {
  useAssignedCurrencyCodes,
  useCurrenciesCatalog,
  useHasMultipleCurrencies,
  usePreferredCurrencyCode,
} from '~/contexts/currencies-catalog-context';

export const NIGERIAN_STATES = [
  'Lagos', 'Abuja (FCT)', 'Rivers', 'Oyo', 'Kano', 'Delta', 'Edo', 'Ogun',
  'Anambra', 'Enugu', 'Kaduna', 'Imo', 'Abia', 'Kwara', 'Osun', 'Ondo',
  'Ekiti', 'Bayelsa', 'Cross River', 'Akwa Ibom', 'Plateau', 'Benue',
  'Nasarawa', 'Niger', 'Kogi', 'Taraba', 'Adamawa', 'Bauchi', 'Gombe',
  'Borno', 'Yobe', 'Jigawa', 'Zamfara', 'Sokoto', 'Kebbi', 'Katsina', 'Ebonyi',
];

type PricedOffer = { label: string; price: string; pricesByCurrency?: Record<string, string> };

/**
 * Country (= currency), offer pricing and delivery regions for a manually keyed
 * order (offline / delivered follow-up). Starts on the top-bar country, else the
 * user's only assigned country. With several countries and "All countries" in
 * the top bar it starts EMPTY: the user must pick (`countryMissing`), so an
 * order is never saved as the base currency by accident. Never prices a
 * non-base order at the base (NGN) price: an offer with no price in the chosen
 * currency is reported as unpriced (null).
 */
export function useOrderCurrencyPricing(
  offers: PricedOffer[],
  selectedOfferLabel: string,
  clearSelectedOffer: () => void,
  /** Clears other country-dependent fields (delivery state) when the country changes. */
  onCountryChange?: () => void,
) {
  const allCurrencies = useCurrenciesCatalog();
  const baseCur = allCurrencies.find((c) => c.isDefault && c.active) ?? allCurrencies[0];
  const showCurrency = useHasMultipleCurrencies();
  const preferredCurrency = usePreferredCurrencyCode();
  const assignedCodes = useAssignedCurrencyCodes();
  const initialCurrencyCode = () =>
    allCurrencies.find((c) => c.active && c.code.toUpperCase() === preferredCurrency)?.code ??
    (showCurrency ? '' : baseCur?.code ?? 'NGN');
  const [currencyCode, setCurrencyCodeState] = useState<string>(initialCurrencyCode);
  /** Several countries and none picked yet: the form must ask. */
  const countryMissing = !currencyCode;

  /** Countries the user can create orders for: active currencies, limited to their assigned countries. */
  const countryOptions = allCurrencies
    .filter(
      (c, i, arr) =>
        c.active &&
        arr.findIndex((x) => x.code === c.code) === i &&
        (assignedCodes.length === 0 || assignedCodes.includes(c.code.toUpperCase())),
    )
    .map((c) => ({ value: c.code, label: `${c.countryName || c.code} (${c.code})` }));

  const setCurrencyCode = (code: string) => {
    if (code === currencyCode) return;
    setCurrencyCodeState(code);
    onCountryChange?.();
  };

  /** Back to the starting country (after a create), so the next order asks again. */
  const resetCountry = () => setCurrencyCodeState(initialCurrencyCode());

  const currentCurrencyInfo = allCurrencies.find((c) => c.code === currencyCode) ?? baseCur;
  const isBaseCurrency = !!currencyCode && (!baseCur || currencyCode === baseCur.code);

  const offerPriceInCurrency = (o: PricedOffer): number | null => {
    if (!currencyCode) return null;
    if (isBaseCurrency) return Number(o.price);
    const raw = o.pricesByCurrency?.[currencyCode.toUpperCase()];
    return raw != null && Number(raw) > 0 ? Number(raw) : null;
  };

  const pricedOffers = offers.filter((o) => offerPriceInCurrency(o) != null);
  const firstPricedOfferLabel = pricedOffers[0]?.label ?? '';

  const selectedOffer = offers.find((o) => o.label === selectedOfferLabel);
  const selectedOfferPrice = selectedOffer ? offerPriceInCurrency(selectedOffer) : null;

  // Switching currency can leave the picked offer unpriced; drop it.
  useEffect(() => {
    if (selectedOffer && selectedOfferPrice == null) clearSelectedOffer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currencyCode]);

  /** Delivery regions for the order's country; Nigeria keeps its state list. None until a country is picked. */
  const orderCountry = countryForCurrency(currencyCode)?.country ?? 'Nigeria';
  const regionOptions = !currencyCode
    ? []
    : orderCountry === 'Nigeria'
      ? NIGERIAN_STATES
      : [...regionsForCountry(orderCountry)];

  return {
    showCurrency,
    countryMissing,
    countryOptions,
    currencyCode,
    setCurrencyCode,
    resetCountry,
    currentCurrencyInfo,
    isBaseCurrency,
    offerPriceInCurrency,
    pricedOffers,
    firstPricedOfferLabel,
    selectedOfferPrice,
    regionOptions,
  };
}
