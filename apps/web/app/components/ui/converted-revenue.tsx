import { Link, useRouteLoaderData } from '@remix-run/react';
import { formatMoney, currencyByCode, NGN } from '@yannis/shared';
import { useCurrenciesCatalog } from '~/contexts/currencies-catalog-context';
import { canManageCurrencies } from '~/lib/rbac';

interface Props {
  /** ₦-equivalent total, already FX-converted by the API. */
  amount: number;
  /** Raw amount per currency, shown on hover as the breakdown. */
  byCurrency?: Record<string, number> | null;
  /** Raw amounts the API could not convert (no FX rate). Shown beside the total. */
  unconverted?: Record<string, number> | null;
  className?: string;
}

/**
 * Delivered revenue across every country as one ₦ figure (the same number ROAS
 * uses). Hover shows each currency's own amount whenever any of it is foreign.
 * A currency with no FX rate is never folded in 1:1: it is listed separately,
 * with a "Set FX rate" link for users who can edit rates.
 */
export function ConvertedRevenue({ amount, byCurrency, unconverted, className }: Props) {
  const currencies = useCurrenciesCatalog();
  const adminData = useRouteLoaderData('routes/admin') as
    | { user?: { role: string; permissions?: string[] | null } | null }
    | undefined;
  const canSetRate = canManageCurrencies(adminData?.user);
  const fmt = (value: number, code: string) => formatMoney(Math.round(value), currencyByCode(currencies, code));

  const slices = Object.entries(byCurrency ?? {}).filter(([, v]) => v);
  const hasForeign = slices.some(([code]) => code.toUpperCase() !== NGN.code);
  const title = hasForeign ? `In ₦ at current FX rates. ${slices.map(([code, v]) => fmt(v, code)).join(' + ')}` : undefined;
  const missing = Object.entries(unconverted ?? {}).filter(([, v]) => v);

  return (
    <span className={className} title={title}>
      {fmt(amount, NGN.code)}
      {missing.map(([code, v]) => (
        <span key={code} className="ml-2 whitespace-nowrap text-xs text-app-fg-muted">
          + {fmt(v, code)}{' '}
          {canSetRate ? (
            <Link to="/admin/settings/currencies" className="text-brand-500 hover:text-brand-600 underline">
              Set FX rate
            </Link>
          ) : (
            '(no FX rate)'
          )}
        </span>
      ))}
    </span>
  );
}
