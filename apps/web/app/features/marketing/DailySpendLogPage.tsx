import { useCallback, useEffect, useRef, useState } from 'react';
import { useFetcher, useNavigate, useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { Spinner } from '~/components/ui/spinner';
import { useFetcherToast } from '~/components/ui/toast';
import { formatNaira } from '~/lib/format-amount';
import { invalidateCachedLoader } from '~/lib/loader-cache';
import { cpaColorClass } from '~/lib/rate-color';
import { fetchOrderCountForDate, type OrderCountForDateResult } from '~/lib/trpc-browser';

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function DailySpendLogPage() {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const dateParam = searchParams.get('date');
  useFetcherToast(fetcher.data, { successMessage: 'Spend saved' });

  const [spendDate, setSpendDate] = useState(() => dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayYmd());
  const [spendAmount, setSpendAmount] = useState<number | null>(null);
  const [orderData, setOrderData] = useState<OrderCountForDateResult | null>(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch order count + existing record whenever spendDate changes
  const fetchData = useCallback((date: string) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    fetchOrderCountForDate(date, ac.signal).then((result) => {
      if (ac.signal.aborted) return;
      setOrderData(result);
      // Pre-fill spend amount if an existing record exists
      if (result?.existingRecord) {
        setSpendAmount(Number(result.existingRecord.spendAmount));
      } else {
        setSpendAmount(null);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    fetchData(spendDate);
    return () => abortRef.current?.abort();
  }, [spendDate, fetchData]);

  // Navigate to list on success — bust the ad-spend list cache so the new row
  // appears immediately instead of showing stale cached data.
  useEffect(() => {
    if (fetcher.data?.success) {
      invalidateCachedLoader('/admin/marketing/ad-spend');
      // Navigate with the spend date so the "today" default filter matches the
      // newly logged entry (avoids blank list if TZ offsets push the date).
      const params = new URLSearchParams();
      params.set('startDate', spendDate);
      params.set('endDate', spendDate);
      const t = setTimeout(() => navigate(`/admin/marketing/ad-spend?${params}`), 600);
      return () => clearTimeout(t);
    }
  }, [fetcher.data, navigate, spendDate]);

  const orderCount = orderData?.orderCount ?? 0;
  const existing = orderData?.existingRecord ?? null;
  const cpa = spendAmount != null && spendAmount > 0 && orderCount > 0 ? spendAmount / orderCount : null;
  const isUpdate = !!existing;
  const isLocked = existing?.status === 'APPROVED';
  const submitting = fetcher.state === 'submitting';
  const canSubmit = spendAmount !== null && spendAmount >= 0 && !loading && !submitting;

  function handleSubmit() {
    if (!canSubmit) return;
    const fd = new FormData();
    fd.set('intent', 'logDailySpend');
    fd.set('spendDate', spendDate);
    fd.set('spendAmount', String(spendAmount));
    fetcher.submit(fd, { method: 'post' });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isUpdate ? 'Update daily spend' : 'Log daily spend'}
        description={isUpdate ? 'Update your ad spend for this day.' : 'Enter your total ad spend for the day.'}
        backTo="/admin/marketing/ad-spend"
      />

      <div className="card space-y-5">
        {/* Date + Spend — primary inputs */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-app-border bg-app-bg p-3">
            <label htmlFor="spendDate" className="block text-xs font-medium text-app-fg-muted mb-1.5 uppercase tracking-wide">
              Date
            </label>
            <input
              id="spendDate"
              type="date"
              value={spendDate}
              max={todayYmd()}
              onChange={(e) => setSpendDate(e.target.value)}
              className="input-base w-full"
            />
          </div>

          <div className="rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50/50 dark:bg-brand-950/20 p-3 ring-1 ring-brand-100 dark:ring-brand-900">
            <label htmlFor="spendAmount" className="block text-xs font-medium text-brand-700 dark:text-brand-300 mb-1.5 uppercase tracking-wide">
              Spend amount
            </label>
            <AmountInput
              id="spendAmount"
              prefix="₦"
              value={spendAmount !== null ? String(spendAmount) : ''}
              onChange={(raw) => {
                const n = Number(raw.replace(/,/g, ''));
                setSpendAmount(raw === '' ? null : isNaN(n) ? null : n);
              }}
              placeholder="0.00"
            />
          </div>
        </div>

        {/* Orders + CPA — derived stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-app-border bg-app-bg p-3">
            <span className="block text-xs font-medium text-app-fg-muted mb-1.5 uppercase tracking-wide">Orders</span>
            <div className="h-10 md:h-9 flex items-center justify-center">
              {loading ? (
                <Spinner size="sm" />
              ) : (
                <span className="text-2xl font-bold text-app-fg tabular-nums">{orderCount}</span>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-app-border bg-app-bg p-3">
            <span className="block text-xs font-medium text-app-fg-muted mb-1.5 uppercase tracking-wide">CPA</span>
            <div className="h-10 md:h-9 flex items-center justify-center">
              {cpa !== null ? (
                <span className={`text-2xl font-bold tabular-nums ${cpaColorClass(cpa)}`}>
                  {formatNaira(Math.round(cpa * 100) / 100)}
                </span>
              ) : spendAmount != null && spendAmount > 0 && orderCount === 0 ? (
                <span className="text-xs text-app-fg-muted">No orders</span>
              ) : (
                <span className="text-2xl font-bold text-app-fg-muted">{'\u2014'}</span>
              )}
            </div>
          </div>
        </div>

        {/* Existing record banner */}
        {isUpdate && !loading && (
          <div className={`rounded-lg px-4 py-3 text-sm ${
            isLocked
              ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
              : 'bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
          }`}>
            {isLocked
              ? "This day\u2019s spend is approved. Submitting will send it for re-approval."
              : `You already logged spend for this date (${existing.status.toLowerCase()}). Submitting will update it.`}
          </div>
        )}

        {/* Error */}
        {fetcher.data && 'error' in fetcher.data && fetcher.data.error && (
          <p className="text-sm text-danger-600 dark:text-danger-400">{fetcher.data.error}</p>
        )}

        {/* Submit */}
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          loading={submitting}
          loadingText={isUpdate ? 'Updating…' : 'Logging…'}
          className="w-full sm:w-auto sm:px-8"
        >
          {isUpdate ? 'Update Spend' : 'Log Spend'}
        </Button>
      </div>
    </div>
  );
}
