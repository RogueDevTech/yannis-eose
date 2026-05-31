import { useCallback, useEffect, useRef, useState } from 'react';
import { useFetcher, useNavigate, useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';
import { Spinner } from '~/components/ui/spinner';
import { useFetcherToast } from '~/components/ui/toast';
import { formatNaira } from '~/lib/format-amount';
import { invalidateCachedLoader } from '~/lib/loader-cache';
import { cpaColorClass } from '~/lib/rate-color';
import { fetchOrderCountForDate, type OrderCountForDateResult } from '~/lib/trpc-browser';
import type { ExpenseCategory } from './types';
import { EXPENSE_CATEGORY_OPTIONS } from './expense-category-options';

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
  const [category, setCategory] = useState<ExpenseCategory>('AD_SPEND');
  const [simpleDescription, setSimpleDescription] = useState('');
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
      invalidateCachedLoader('/admin/marketing/expenses');
      // Navigate with the spend date so the "today" default filter matches the
      // newly logged entry (avoids blank list if TZ offsets push the date).
      const params = new URLSearchParams();
      params.set('startDate', spendDate);
      params.set('endDate', spendDate);
      const t = setTimeout(() => navigate(`/admin/marketing/expenses?${params}`), 600);
      return () => clearTimeout(t);
    }
  }, [fetcher.data, navigate, spendDate]);

  const orderCount = orderData?.orderCount ?? 0;
  const existing = orderData?.existingRecord ?? null;
  const cpa = spendAmount != null && spendAmount > 0 && orderCount > 0 ? spendAmount / orderCount : null;
  const isUpdate = !!existing;
  const isLocked = existing?.status === 'APPROVED';
  const submitting = fetcher.state === 'submitting';
  const canSubmit = spendAmount !== null && spendAmount >= 0 && !submitting && (category !== 'AD_SPEND' || !loading);

  function handleSubmit() {
    if (!canSubmit) return;
    const fd = new FormData();
    if (category !== 'AD_SPEND') {
      fd.set('intent', 'createSimpleExpense');
      fd.set('spendDate', spendDate);
      fd.set('category', category);
      fd.set('spendAmount', String(spendAmount));
      if (simpleDescription.trim()) fd.set('description', simpleDescription.trim());
    } else {
      fd.set('intent', 'logDailySpend');
      fd.set('spendDate', spendDate);
      fd.set('spendAmount', String(spendAmount));
    }
    fetcher.submit(fd, { method: 'post' });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isUpdate ? 'Update expense' : 'Log expense'}
        description="Select a category and enter the details."
        backTo="/admin/marketing/expenses"
      />

      <div className="card space-y-5">
        {/* Category — standalone pill-style selector */}
        <FormSelect
          id="expenseCategory"
          label="Expense type"
          value={category}
          onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
          options={EXPENSE_CATEGORY_OPTIONS}
        />

        {/* Non-AD_SPEND: Date + Amount + Description + Submit */}
        {category !== 'AD_SPEND' && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <TextInput
                id="spendDate"
                type="date"
                label="Date"
                value={spendDate}
                max={todayYmd()}
                onChange={(e) => setSpendDate(e.target.value)}
              />
              <TextInput
                id="spendAmount"
                label="Amount (₦)"
                value={spendAmount !== null ? spendAmount.toLocaleString() : ''}
                onChange={(e) => {
                  const raw = e.target.value.replace(/,/g, '');
                  if (raw === '') { setSpendAmount(null); return; }
                  const n = Number(raw);
                  if (!isNaN(n)) setSpendAmount(n);
                }}
                placeholder="0.00"
              />
              <TextInput
                id="simpleDescription"
                label="Description"
                value={simpleDescription}
                onChange={(e) => setSimpleDescription(e.target.value)}
                placeholder="What was this for?"
              />
              <Button
                type="button"
                variant="primary"
                onClick={handleSubmit}
                disabled={!canSubmit}
                loading={submitting}
                loadingText="…"
                className="h-10 md:h-9 w-full mt-2 sm:mt-0"
              >
                Submit
              </Button>
            </div>
            {fetcher.data && 'error' in fetcher.data && fetcher.data.error && (
              <p className="text-sm text-danger-600 dark:text-danger-400">{fetcher.data.error}</p>
            )}
          </>
        )}

        {/* AD_SPEND: Date + Amount + Orders + CPA + Submit */}
        {category === 'AD_SPEND' && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
              <TextInput
                id="spendDate"
                type="date"
                label="Date"
                value={spendDate}
                max={todayYmd()}
                onChange={(e) => setSpendDate(e.target.value)}
              />
              <TextInput
                id="spendAmount"
                label="Amount (₦)"
                value={spendAmount !== null ? spendAmount.toLocaleString() : ''}
                onChange={(e) => {
                  const raw = e.target.value.replace(/,/g, '');
                  if (raw === '') { setSpendAmount(null); return; }
                  const n = Number(raw);
                  if (!isNaN(n)) setSpendAmount(n);
                }}
                placeholder="0.00"
              />
              <div>
                <span className="block text-sm font-medium text-app-fg-muted mb-1">Orders</span>
                <div className="h-10 md:h-9 flex items-center justify-center rounded-lg border border-app-border bg-app-canvas text-sm font-semibold text-app-fg tabular-nums">
                  {loading ? <Spinner size="sm" /> : orderCount}
                </div>
              </div>
              <div>
                <span className="block text-sm font-medium text-app-fg-muted mb-1">CPA</span>
                <div className="h-10 md:h-9 flex items-center justify-center rounded-lg border border-app-border bg-app-canvas text-sm font-semibold tabular-nums">
                  {cpa !== null ? (
                    <span className={cpaColorClass(cpa)}>{formatNaira(Math.round(cpa * 100) / 100)}</span>
                  ) : (
                    <span className="text-app-fg-muted">{'\u2014'}</span>
                  )}
                </div>
              </div>
              <Button
                type="button"
                variant="primary"
                onClick={handleSubmit}
                disabled={!canSubmit}
                loading={submitting}
                loadingText="…"
                className="h-10 md:h-9 w-full mt-2 sm:mt-0"
              >
                {isUpdate ? 'Update' : 'Log'}
              </Button>
            </div>

            {isUpdate && !loading && (
              <p className={`text-xs px-3 py-2 rounded-md ${
                isLocked
                  ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300'
                  : 'bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300'
              }`}>
                {isLocked
                  ? "Approved — submitting sends for re-approval."
                  : `Existing ${existing.status.toLowerCase()} record — submitting will update.`}
              </p>
            )}

            {fetcher.data && 'error' in fetcher.data && fetcher.data.error && (
              <p className="text-sm text-danger-600 dark:text-danger-400">{fetcher.data.error}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
