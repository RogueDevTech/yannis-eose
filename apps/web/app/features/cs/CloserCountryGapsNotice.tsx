import { useEffect, useState } from 'react';
import { useFetcher, useLocation, useRevalidator } from '@remix-run/react';
import { countryForCurrency } from '@yannis/shared';
import { useFetcherToast } from '~/components/ui/toast';
import { TableActionButton } from '~/components/ui/table-action-button';
import { invalidateCachedLoader } from '~/lib/loader-cache';

/** A closer the Assign lists hide in a branch (API: `UsersService.listCloserCountryGaps`). */
export interface CloserCountryGap {
  userId: string;
  userName: string;
  branchId: string;
  branchName: string;
  companyId: string;
  companyName: string;
  currencyCode: string;
  orders30d: number;
}

function countryLabel(code: string): string {
  return countryForCurrency(code)?.country ?? code;
}

/**
 * Warning on Team Analysis: closers who sit in a country's branch but have no
 * access to that country in its company, so Assign lists leave them out.
 * Holders of `users.update` get a one-click "Add access" per row.
 */
export function CloserCountryGapsNotice({
  gaps,
  canGrant,
}: {
  gaps: CloserCountryGap[];
  canGrant: boolean;
}) {
  const fetcher = useFetcher<{ success?: boolean; error?: string; message?: string }>();
  useFetcherToast(fetcher.data);
  const [expanded, setExpanded] = useState(false);
  const { pathname } = useLocation();
  const revalidator = useRevalidator();

  // The page uses the cached client loader: drop it after a grant so the
  // fixed closer leaves the list instead of coming back from cache.
  const granted = fetcher.state === 'idle' && fetcher.data?.success === true ? fetcher.data : null;
  useEffect(() => {
    if (!granted) return;
    invalidateCachedLoader(pathname);
    revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granted]);

  if (gaps.length === 0) return null;

  const pendingKey =
    fetcher.state !== 'idle' ? `${fetcher.formData?.get('userId')}:${fetcher.formData?.get('branchId')}` : null;
  const shown = expanded ? gaps : gaps.slice(0, 3);
  const noun = gaps.length === 1 ? 'closer is' : 'closers are';

  return (
    <div
      role="alert"
      className="rounded-lg border border-warning-200 bg-warning-50 px-3 py-2.5 dark:border-warning-700/50 dark:bg-warning-700/20 md:px-4 md:py-3"
    >
      <p className="text-sm font-medium text-warning-800 dark:text-warning-200">
        {gaps.length} {noun} hidden from Assign lists
      </p>
      <p className="mt-0.5 text-xs text-warning-800/80 dark:text-warning-200/80">
        They are in a country&apos;s branch without access to that country.
        {canGrant ? '' : ' Ask an admin to add the country in their user settings.'}
      </p>
      <ul className="mt-2 divide-y divide-warning-200/70 dark:divide-warning-700/40">
        {shown.map((g) => {
          const key = `${g.userId}:${g.branchId}`;
          const country = countryLabel(g.currencyCode);
          return (
            <li key={key} className="flex items-center justify-between gap-3 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-app-fg">{g.userName}</p>
                <p className="truncate text-xs text-app-fg-muted">
                  {g.branchName} ({g.companyName}): no {country} access
                </p>
              </div>
              {canGrant && (
                <fetcher.Form method="post" className="shrink-0">
                  <input type="hidden" name="intent" value="grantCloserCountry" />
                  <input type="hidden" name="userId" value={g.userId} />
                  <input type="hidden" name="branchId" value={g.branchId} />
                  <TableActionButton type="submit" variant="primary" disabled={pendingKey !== null}>
                    {pendingKey === key ? 'Adding…' : `Add ${country}`}
                  </TableActionButton>
                </fetcher.Form>
              )}
            </li>
          );
        })}
      </ul>
      {gaps.length > 3 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-medium text-warning-800 underline-offset-2 hover:underline dark:text-warning-200"
        >
          {expanded ? 'Show less' : `Show all ${gaps.length}`}
        </button>
      )}
    </div>
  );
}
