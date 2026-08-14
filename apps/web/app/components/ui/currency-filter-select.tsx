import { useSearchParams } from '@remix-run/react';
import { FormSelect } from '~/components/ui/form-select';
import { useCurrenciesCatalog, useHasMultipleCurrencies } from '~/contexts/currencies-catalog-context';

interface Props {
  /** The search-param key this filter drives. Defaults to 'currency'. */
  paramKey?: string;
  className?: string;
}

/**
 * Currency filter for order/finance lists. Renders NOTHING when the company has
 * a single active currency (feature dormant) — so it's a safe drop-in anywhere.
 * When multiple currencies exist, it offers "All currencies" + one option per
 * active currency, syncing the `currency` search param (resets page to 1).
 */
export function CurrencyFilterSelect({ paramKey = 'currency', className }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const currencies = useCurrenciesCatalog();
  const multi = useHasMultipleCurrencies();
  if (!multi) return null;

  const current = searchParams.get(paramKey) ?? '';
  const options = [
    { value: '', label: 'All currencies' },
    ...currencies
      .filter((c) => c.active)
      .map((c) => ({ value: c.code, label: `${c.symbol} ${c.code}` })),
  ];

  return (
    <FormSelect
      aria-label="Currency"
      className={className}
      value={current}
      options={options}
      onChange={(e) => {
        const next = new URLSearchParams(searchParams);
        const v = e.target.value;
        if (v) next.set(paramKey, v);
        else next.delete(paramKey);
        next.delete('page');
        setSearchParams(next, { preventScrollReset: true });
      }}
    />
  );
}
