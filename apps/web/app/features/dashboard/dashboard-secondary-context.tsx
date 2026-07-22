import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import type { DashboardData, DashboardFilters } from './types';
import type { DashboardSecondaryApiPayload } from '~/routes/api.dashboard-secondary';
import { InlineNotification } from '~/components/ui/inline-notification';

type ApiOk = { ok: true } & DashboardSecondaryApiPayload;
type ApiErr = { ok: false; error: string } & DashboardSecondaryApiPayload;
export type DashboardSecondaryApiResponse = ApiOk | ApiErr;

type CtxValue = {
  loading: boolean;
  error: string | null;
  /** Present when `ok` and not loading */
  bundle: DashboardSecondaryApiPayload | null;
  retry: () => void;
};

const DashboardSecondaryContext = createContext<CtxValue | null>(null);

export function DashboardSecondaryProvider({
  filters,
  children,
}: {
  filters: DashboardFilters;
  children: React.ReactNode;
}) {
  const fetcher = useFetcher<DashboardSecondaryApiResponse>();
  const qs = useMemo(
    () => buildQuery(filters),
    [filters.startDate, filters.endDate, filters.periodAllTime, filters.teamId],
  );
  // Cache-bust: include a mount timestamp so a page reload after branch switch
  // doesn't serve a stale HTTP-cached response (max-age=10 on the secondary API).
  const [mountTs] = useState(() => Date.now());

  useEffect(() => {
    void fetcher.load(`/api/dashboard-secondary?${qs}&_t=${mountTs}`);
  }, [qs, mountTs]);

  const retry = useCallback(() => {
    void fetcher.load(`/api/dashboard-secondary?${qs}&_t=${Date.now()}`);
  }, [fetcher, qs]);

  const value = useMemo((): CtxValue => {
    const d = fetcher.data;
    const loading = fetcher.state === 'loading' && !d;
    if (d && !d.ok) {
      return { loading: false, error: d.error ?? 'Failed to load', bundle: null, retry };
    }
    if (d?.ok) {
      return {
        loading: false,
        error: null,
        bundle: {
          metrics: d.metrics,
          personalMetrics: d.personalMetrics,
          profit: d.profit,
          totalUsers: d.totalUsers,
          totalProducts: d.totalProducts,
          payoutSummary: d.payoutSummary,
          abandonedCartCount: d.abandonedCartCount ?? 0,
          followUpCounts: d.followUpCounts,
          cartOrdersCounts: d.cartOrdersCounts,
          deliveredFollowUpCounts: d.deliveredFollowUpCounts,
          marketingStatusCounts: d.marketingStatusCounts,
        },
        retry,
      };
    }
    return { loading, error: null, bundle: null, retry };
  }, [fetcher.state, fetcher.data, retry]);

  return (
    <DashboardSecondaryContext.Provider value={value}>{children}</DashboardSecondaryContext.Provider>
  );
}

function buildQuery(filters: DashboardFilters): string {
  const p = new URLSearchParams();
  if (filters.startDate) p.set('startDate', filters.startDate);
  if (filters.endDate) p.set('endDate', filters.endDate);
  if (filters.periodAllTime) p.set('periodAllTime', 'true');
  if (filters.teamId) p.set('teamId', filters.teamId);
  return p.toString();
}

export function useDashboardSecondary(): CtxValue {
  const v = useContext(DashboardSecondaryContext);
  if (!v) {
    throw new Error('useDashboardSecondary must be used within DashboardSecondaryProvider');
  }
  return v;
}

/** KPI strip / card that depends on `marketing.metrics` */
export function DashboardMetricsSection({
  fallback,
  children,
}: {
  fallback: React.ReactNode;
  children: (metrics: DashboardData['metrics'], abandonedCartCount: number, cartOrdersCounts?: Record<string, number>, marketingStatusCounts?: Record<string, number>) => React.ReactNode;
}) {
  const { loading, error, bundle, retry } = useDashboardSecondary();
  if (error) {
    return (
      <InlineNotification
        variant="danger"
        message={error}
        actions={[{ label: 'Retry', onClick: retry }]}
      />
    );
  }
  if (loading || !bundle) return <>{fallback}</>;
  return <>{children(bundle.metrics, bundle.abandonedCartCount, bundle.cartOrdersCounts, bundle.marketingStatusCounts)}</>;
}

/** Supervisor-aware section: provides both team and personal metrics when available. */
export function DashboardSupervisorMetricsSection({
  fallback,
  children,
}: {
  fallback: React.ReactNode;
  children: (teamMetrics: DashboardData['metrics'], personalMetrics: DashboardData['metrics'] | null, abandonedCartCount: number, cartOrdersCounts?: Record<string, number>, marketingStatusCounts?: Record<string, number>) => React.ReactNode;
}) {
  const { loading, error, bundle, retry } = useDashboardSecondary();
  if (error) {
    return (
      <InlineNotification
        variant="danger"
        message={error}
        actions={[{ label: 'Retry', onClick: retry }]}
      />
    );
  }
  if (loading || !bundle) return <>{fallback}</>;
  return <>{children(bundle.metrics, bundle.personalMetrics ?? null, bundle.abandonedCartCount, bundle.cartOrdersCounts, bundle.marketingStatusCounts)}</>;
}

export function DashboardProfitSection({
  fallback,
  children,
}: {
  fallback: React.ReactNode;
  children: (profit: DashboardData['profit']) => React.ReactNode;
}) {
  const { loading, error, bundle, retry } = useDashboardSecondary();
  if (error) {
    return (
      <InlineNotification
        variant="danger"
        message={error}
        actions={[{ label: 'Retry', onClick: retry }]}
      />
    );
  }
  if (loading || !bundle) return <>{fallback}</>;
  return <>{children(bundle.profit)}</>;
}

export function DashboardTotalProductsSection({
  fallback,
  children,
}: {
  fallback: React.ReactNode;
  children: (totalProducts: number) => React.ReactNode;
}) {
  const { loading, error, bundle, retry } = useDashboardSecondary();
  if (error) {
    return (
      <InlineNotification
        variant="danger"
        message={error}
        actions={[{ label: 'Retry', onClick: retry }]}
      />
    );
  }
  if (loading || !bundle) return <>{fallback}</>;
  return <>{children(bundle.totalProducts)}</>;
}

export function DashboardHRSection({
  fallback,
  children,
}: {
  fallback: React.ReactNode;
  children: (args: {
    payoutSummary: DashboardData['payoutSummary'];
    totalUsers: number;
  }) => React.ReactNode;
}) {
  const { loading, error, bundle, retry } = useDashboardSecondary();
  if (error) {
    return (
      <InlineNotification
        variant="danger"
        message={error}
        actions={[{ label: 'Retry', onClick: retry }]}
      />
    );
  }
  if (loading || !bundle) return <>{fallback}</>;
  return <>{children({ payoutSummary: bundle.payoutSummary, totalUsers: bundle.totalUsers })}</>;
}

export function DashboardFollowUpSection({
  fallback,
  children,
}: {
  fallback: React.ReactNode;
  children: (counts: Record<string, number>) => React.ReactNode;
}) {
  const { loading, error, bundle, retry } = useDashboardSecondary();
  if (error) {
    return (
      <InlineNotification
        variant="danger"
        message={error}
        actions={[{ label: 'Retry', onClick: retry }]}
      />
    );
  }
  if (loading || !bundle || !bundle.followUpCounts) return <>{fallback}</>;
  return <>{children(bundle.followUpCounts)}</>;
}

export function DashboardCartOrdersSection({
  fallback,
  children,
}: {
  fallback: React.ReactNode;
  children: (counts: Record<string, number>) => React.ReactNode;
}) {
  const { loading, error, bundle, retry } = useDashboardSecondary();
  if (error) {
    return (
      <InlineNotification
        variant="danger"
        message={error}
        actions={[{ label: 'Retry', onClick: retry }]}
      />
    );
  }
  if (loading || !bundle || !bundle.cartOrdersCounts) return <>{fallback}</>;
  return <>{children(bundle.cartOrdersCounts)}</>;
}

export function DashboardDeliveredFollowUpSection({
  fallback,
  children,
}: {
  fallback: React.ReactNode;
  children: (counts: Record<string, number>) => React.ReactNode;
}) {
  const { loading, error, bundle, retry } = useDashboardSecondary();
  if (error) {
    return (
      <InlineNotification
        variant="danger"
        message={error}
        actions={[{ label: 'Retry', onClick: retry }]}
      />
    );
  }
  if (loading || !bundle || !bundle.deliveredFollowUpCounts) return <>{fallback}</>;
  return <>{children(bundle.deliveredFollowUpCounts)}</>;
}
