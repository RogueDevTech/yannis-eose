import { useEffect, useState } from 'react';
import { countryForCurrency, regionsForCountry } from '@yannis/shared';
import {
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
 * Currency, offer pricing and delivery regions for a manually keyed order
 * (offline / delivered follow-up). Starts on the user's country, and never
 * prices a non-base order at the base (NGN) price: an offer with no price in
 * the chosen currency is reported as unpriced (null).
 */
export function useOrderCurrencyPricing(
  offers: PricedOffer[],
  selectedOfferLabel: string,
  clearSelectedOffer: () => void,
) {
  const allCurrencies = useCurrenciesCatalog();
  const baseCur = allCurrencies.find((c) => c.isDefault && c.active) ?? allCurrencies[0];
  const showCurrency = useHasMultipleCurrencies();
  const preferredCurrency = usePreferredCurrencyCode();
  const [currencyCode, setCurrencyCode] = useState<string>(
    () =>
      allCurrencies.find((c) => c.active && c.code.toUpperCase() === preferredCurrency)?.code ?? baseCur?.code ?? 'NGN',
  );

  const currentCurrencyInfo = allCurrencies.find((c) => c.code === currencyCode) ?? baseCur;
  const isBaseCurrency = !baseCur || currencyCode === baseCur.code;

  const offerPriceInCurrency = (o: PricedOffer): number | null => {
    if (isBaseCurrency) return Number(o.price);
    const raw = o.pricesByCurrency?.[currencyCode.toUpperCase()];
    return raw != null && Number(raw) > 0 ? Number(raw) : null;
  };

  /** Currencies that price at least one offer of the product, plus the current pick. */
  const availableCurrencies = allCurrencies.filter(
    (c, i, arr) =>
      c.active &&
      arr.findIndex((x) => x.code === c.code) === i &&
      (c.code === baseCur?.code ||
        c.code === currencyCode ||
        offers.some((o) => o.pricesByCurrency?.[c.code.toUpperCase()] != null)),
  );
  const pricedOffers = offers.filter((o) => offerPriceInCurrency(o) != null);
  const firstPricedOfferLabel = pricedOffers[0]?.label ?? '';

  const selectedOffer = offers.find((o) => o.label === selectedOfferLabel);
  const selectedOfferPrice = selectedOffer ? offerPriceInCurrency(selectedOffer) : null;

  // Switching currency can leave the picked offer unpriced; drop it.
  useEffect(() => {
    if (selectedOffer && selectedOfferPrice == null) clearSelectedOffer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currencyCode]);

  /** Delivery regions for the order's country; Nigeria keeps its state list. */
  const orderCountry = countryForCurrency(currencyCode)?.country ?? 'Nigeria';
  const regionOptions = orderCountry === 'Nigeria' ? NIGERIAN_STATES : [...regionsForCountry(orderCountry)];

  return {
    showCurrency,
    currencyCode,
    setCurrencyCode,
    currentCurrencyInfo,
    isBaseCurrency,
    availableCurrencies,
    offerPriceInCurrency,
    pricedOffers,
    firstPricedOfferLabel,
    selectedOfferPrice,
    regionOptions,
  };
}
