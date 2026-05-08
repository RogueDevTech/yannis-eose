import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useActionData, useNavigation, useSubmit } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import { NumberInput } from '~/components/ui/number-input';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { AmountInput } from '~/components/ui/amount-input';
import { FormField } from '~/components/ui/form-field';
import { FileUpload, type FileUploadUploadState } from '~/components/ui/file-upload';
import { NairaPrice } from '~/components/ui/naira-price';
import { Spinner } from '~/components/ui/spinner';
import { S3_FOLDERS } from '~/lib/s3-upload';
import { fetchCampaignOrderTotalForBatch } from '~/lib/trpc-browser';
import type { Campaign, Product, AdPlatform } from './types';
import { AD_EXPENSE_PLATFORM_OPTIONS } from './ad-expense-options';

interface ExpenseLine {
  uid: string;
  productId: string;
  spendAmount: string;
  /**
   * Manual order-split — MB's portion of the form's actual order count
   * (CEO directive 2026-05-08). Sum across lines must equal the system total.
   * Stored as string so the input can hold "" while the user is editing
   * without snapping back to 0 on every keystroke.
   */
  attributedOrderCount: string;
  platform: AdPlatform;
  platformCustomLabel: string;
  adUrl: string;
  screenshotUrl: string;
  uploadState: FileUploadUploadState;
}

function emptyLine(uid: string): ExpenseLine {
  return {
    uid,
    productId: '',
    spendAmount: '',
    attributedOrderCount: '',
    platform: 'FACEBOOK',
    platformCustomLabel: '',
    adUrl: '',
    screenshotUrl: '',
    uploadState: 'idle',
  };
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface AddExpenseFormProps {
  campaigns: Campaign[];
  products: Product[];
}

export function AddExpenseForm({ campaigns, products }: AddExpenseFormProps) {
  const submit = useSubmit();
  const navigation = useNavigation();
  const actionData = useActionData<{ error?: string } | undefined>();
  const idBase = useId();
  const lineCounterRef = useRef(0);
  const newLineUid = () => `${idBase}line-${++lineCounterRef.current}`;

  // Batch-level fields (CEO directive 2026-05-08): one form + one date for the
  // whole batch, lines split that form's order count.
  const [spendDate, setSpendDate] = useState(todayYmd());
  const [campaignId, setCampaignId] = useState('');
  const [lines, setLines] = useState<ExpenseLine[]>(() => [emptyLine(newLineUid())]);

  const productOptions = useMemo(
    () => products.map((p) => ({ value: p.id, label: p.name })),
    [products],
  );

  const campaignProductMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of campaigns) {
      if (Array.isArray(c.productIds) && c.productIds.length > 0) {
        m.set(c.id, c.productIds.filter((id): id is string => typeof id === 'string' && id.length > 0));
      }
    }
    return m;
  }, [campaigns]);

  // Default the line product to the form's only product when the form has one,
  // so single-product forms (the common case) don't make the MB pick again.
  const defaultProductIdForCampaign = useMemo(() => {
    const ids = campaignProductMap.get(campaignId) ?? [];
    return ids.length === 1 ? ids[0]! : '';
  }, [campaignProductMap, campaignId]);

  useEffect(() => {
    if (!defaultProductIdForCampaign) return;
    setLines((rows) =>
      rows.map((r) => (r.productId ? r : { ...r, productId: defaultProductIdForCampaign })),
    );
  }, [defaultProductIdForCampaign]);

  // Reset a line's product when the form changes (a product carried over from
  // a previously-picked form might not belong to the new one).
  const onCampaignChange = (nextCampaignId: string) => {
    setCampaignId(nextCampaignId);
    const allowedProductIds = campaignProductMap.get(nextCampaignId) ?? [];
    setLines((rows) =>
      rows.map((r) =>
        allowedProductIds.length === 0 || allowedProductIds.includes(r.productId)
          ? r
          : {
              ...r,
              productId: allowedProductIds.length === 1 ? allowedProductIds[0]! : '',
            },
      ),
    );
  };

  const productOptionsForLine = useMemo(() => {
    if (!campaignId) return productOptions;
    const allowed = campaignProductMap.get(campaignId) ?? [];
    if (allowed.length === 0) return productOptions;
    return productOptions.filter((p) => allowed.includes(p.value));
  }, [productOptions, campaignProductMap, campaignId]);

  const updateLine = (uid: string, patch: Partial<ExpenseLine>) => {
    setLines((rows) => {
      const idx = rows.findIndex((r) => r.uid === uid);
      if (idx === -1) return rows;
      const target = rows[idx]!;
      const patchKeys = Object.keys(patch) as Array<keyof ExpenseLine>;
      const isNoOp = patchKeys.every((k) => target[k] === patch[k]);
      if (isNoOp) return rows;
      const next = rows.slice();
      next[idx] = { ...target, ...patch };
      return next;
    });
  };
  const addLine = () =>
    setLines((rows) => [
      ...rows,
      { ...emptyLine(newLineUid()), productId: defaultProductIdForCampaign },
    ]);
  const removeLine = (uid: string) =>
    setLines((rows) => (rows.length === 1 ? rows : rows.filter((r) => r.uid !== uid)));

  // ── System order count for the picked form ───────────────────────────────
  // Pulled 300ms after (campaign, date) settle. The MB must split this number
  // exactly across their lines; the server enforces it on submit.
  const [systemOrderCount, setSystemOrderCount] = useState<number | null>(null);
  const [systemLoading, setSystemLoading] = useState(false);
  const systemKeyRef = useRef('');
  useEffect(() => {
    if (!campaignId || !spendDate) {
      systemKeyRef.current = '';
      setSystemOrderCount(null);
      setSystemLoading(false);
      return;
    }
    const key = `${campaignId}|${spendDate}`;
    if (systemKeyRef.current === key && systemOrderCount != null) return;
    systemKeyRef.current = key;
    setSystemLoading(true);
    const aborter = new AbortController();
    const timer = setTimeout(() => {
      fetchCampaignOrderTotalForBatch({ campaignId, spendDate })
        .then((result) => {
          if (aborter.signal.aborted) return;
          setSystemOrderCount(result?.orderCount ?? 0);
          setSystemLoading(false);
        })
        .catch(() => {
          if (aborter.signal.aborted) return;
          setSystemLoading(false);
        });
    }, 300);
    return () => {
      aborter.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only refetch when key changes
  }, [campaignId, spendDate]);

  const totalSpend = useMemo(
    () =>
      lines.reduce((acc, l) => {
        const n = Number(l.spendAmount.replace(/,/g, ''));
        return acc + (Number.isFinite(n) && n > 0 ? n : 0);
      }, 0),
    [lines],
  );

  const totalSplit = useMemo(
    () =>
      lines.reduce((acc, l) => {
        const n = parseInt(l.attributedOrderCount, 10);
        return acc + (Number.isFinite(n) && n >= 0 ? n : 0);
      }, 0),
    [lines],
  );

  const splitMatchesSystem =
    systemOrderCount != null && totalSplit === systemOrderCount;

  const allLinesValid = useMemo(() => {
    if (!spendDate || !campaignId) return false;
    return lines.every((l) => {
      const amt = Number(l.spendAmount.replace(/,/g, ''));
      const orders = parseInt(l.attributedOrderCount, 10);
      const otherOk = l.platform !== 'OTHER' || l.platformCustomLabel.trim().length > 0;
      return (
        l.productId &&
        l.screenshotUrl &&
        l.uploadState !== 'uploading' &&
        Number.isFinite(amt) &&
        amt > 0 &&
        Number.isFinite(orders) &&
        orders >= 0 &&
        otherOk
      );
    });
  }, [lines, spendDate, campaignId]);

  const canSubmit = allLinesValid && splitMatchesSystem;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const payload = lines.map((l) => {
      const base = {
        productId: l.productId,
        spendAmount: Number(l.spendAmount.replace(/,/g, '')),
        attributedOrderCount: parseInt(l.attributedOrderCount, 10),
        screenshotUrl: l.screenshotUrl,
        platform: l.platform,
        ...(l.adUrl.trim() ? { adUrl: l.adUrl.trim() } : {}),
      };
      if (l.platform === 'OTHER' && l.platformCustomLabel.trim()) {
        return { ...base, platformCustomLabel: l.platformCustomLabel.trim() };
      }
      return base;
    });
    const fd = new FormData();
    fd.set('intent', 'createAdSpendBatch');
    fd.set('spendDate', spendDate);
    fd.set('campaignId', campaignId);
    fd.set('lines', JSON.stringify(payload));
    submit(fd, { method: 'post' });
  };

  const error = actionData?.error;
  const busy = navigation.state === 'submitting';
  const remainingToSplit =
    systemOrderCount != null ? systemOrderCount - totalSplit : null;

  return (
    <div className="space-y-3">
      {/* Batch-level header — pick form + date once for the whole batch. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <FormField label="Form (campaign)" htmlFor="add-expense-campaign" required>
          <SearchableSelect
            id="add-expense-campaign"
            value={campaignId}
            onChange={onCampaignChange}
            options={[
              { value: '', label: 'Select form' },
              ...campaigns.map((c) => ({ value: c.id, label: c.name })),
            ]}
            searchPlaceholder="Search forms..."
            required
          />
        </FormField>
        <FormField label="Date" htmlFor="add-expense-date" required>
          <TextInput
            id="add-expense-date"
            type="date"
            value={spendDate}
            onChange={(e) => setSpendDate(e.target.value)}
            max={todayYmd()}
          />
        </FormField>
      </div>

      {/* System count + split status — the gate the MB must hit before submit. */}
      <div className="rounded-md bg-app-hover px-3 py-2 grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4">
        <div className="flex flex-col">
          <span className="text-[11px] uppercase tracking-wide text-app-fg-muted">
            System order count (this form)
          </span>
          <span className="text-base font-semibold tabular-nums inline-flex items-center gap-1.5">
            {!campaignId ? (
              <span className="text-app-fg-muted">Pick a form</span>
            ) : systemLoading ? (
              <>
                Calculating <Spinner size="sm" className="text-app-fg-muted" />
              </>
            ) : systemOrderCount != null ? (
              systemOrderCount
            ) : (
              '—'
            )}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] uppercase tracking-wide text-app-fg-muted">
            Split so far
          </span>
          <span
            className={[
              'text-base font-semibold tabular-nums',
              splitMatchesSystem
                ? 'text-success-600 dark:text-success-400'
                : systemOrderCount != null
                  ? 'text-warning-600 dark:text-warning-400'
                  : '',
            ].join(' ')}
          >
            {totalSplit}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] uppercase tracking-wide text-app-fg-muted">
            Remaining
          </span>
          <span className="text-base font-semibold tabular-nums">
            {remainingToSplit == null ? '—' : remainingToSplit}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {lines.map((line, idx) => {
          const lineSpend = Number(line.spendAmount.replace(/,/g, ''));
          const lineOrders = parseInt(line.attributedOrderCount, 10);
          const lineCpa =
            Number.isFinite(lineSpend) && lineSpend > 0 && Number.isFinite(lineOrders) && lineOrders > 0
              ? lineSpend / lineOrders
              : null;
          return (
            <div
              key={line.uid}
              className="rounded-lg border border-app-border bg-app-elevated px-3 py-2.5 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-app-fg-muted uppercase tracking-wide">
                  Ads {idx + 1}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeLine(line.uid)}
                  disabled={lines.length === 1}
                >
                  Remove
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                <FormField label="Product" htmlFor={`${line.uid}-product`} required>
                  <SearchableSelect
                    id={`${line.uid}-product`}
                    value={line.productId}
                    onChange={(v) => updateLine(line.uid, { productId: v })}
                    options={[{ value: '', label: 'Select product' }, ...productOptionsForLine]}
                    searchPlaceholder="Search products..."
                    required
                  />
                </FormField>
                <FormField label="Amount (₦)" htmlFor={`${line.uid}-amount`} required>
                  <AmountInput
                    id={`${line.uid}-amount`}
                    value={line.spendAmount}
                    onChange={(v) => updateLine(line.uid, { spendAmount: v })}
                    placeholder="0.00"
                    required
                  />
                </FormField>
                <FormField label="Orders attributed" htmlFor={`${line.uid}-orders`} required>
                  <NumberInput
                    id={`${line.uid}-orders`}
                    min={0}
                    fallbackValue={0}
                    value={
                      line.attributedOrderCount === ''
                        ? 0
                        : Number(line.attributedOrderCount) || 0
                    }
                    onValueChange={(n) => updateLine(line.uid, { attributedOrderCount: String(n) })}
                  />
                </FormField>
                <FormField label="Platform" htmlFor={`${line.uid}-platform`} required>
                  <FormSelect
                    id={`${line.uid}-platform`}
                    value={line.platform}
                    onChange={(e) => {
                      const v = e.target.value as AdPlatform;
                      updateLine(line.uid, {
                        platform: v,
                        platformCustomLabel: v === 'OTHER' ? line.platformCustomLabel : '',
                      });
                    }}
                    options={AD_EXPENSE_PLATFORM_OPTIONS}
                    required
                  />
                </FormField>
                <FormField label="Ad URL" htmlFor={`${line.uid}-adurl`}>
                  <TextInput
                    id={`${line.uid}-adurl`}
                    type="url"
                    value={line.adUrl}
                    onChange={(e) => updateLine(line.uid, { adUrl: e.target.value })}
                    placeholder="https://..."
                  />
                </FormField>
                <FormField label="Screenshot" htmlFor={`${line.uid}-shot`} required>
                  <FileUpload
                    folder={S3_FOLDERS.SCREENSHOTS}
                    onUpload={(url) => updateLine(line.uid, { screenshotUrl: url })}
                    onUploadStateChange={(s) => updateLine(line.uid, { uploadState: s })}
                    required
                    variant="minimal"
                  />
                </FormField>
                {line.platform === 'OTHER' && (
                  <FormField
                    label="Platform name"
                    htmlFor={`${line.uid}-platform-custom`}
                    className="sm:col-span-2 lg:col-span-3"
                  >
                    <TextInput
                      id={`${line.uid}-platform-custom`}
                      value={line.platformCustomLabel}
                      onChange={(e) => updateLine(line.uid, { platformCustomLabel: e.target.value })}
                      placeholder="e.g. Snapchat, Taboola"
                      maxLength={80}
                      required
                    />
                  </FormField>
                )}
              </div>

              {/* Per-line CPA computed from the MB's split. */}
              <div className="grid grid-cols-2 gap-3 rounded-md bg-app-hover/60 px-3 py-2 mt-1">
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase tracking-wide text-app-fg-muted">
                    Orders this line
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-app-fg">
                    {Number.isFinite(lineOrders) && lineOrders >= 0 ? lineOrders : 0}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase tracking-wide text-app-fg-muted">
                    CPA (this line)
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-app-fg">
                    {lineCpa != null ? <NairaPrice amount={Math.round(lineCpa)} /> : '—'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Button type="button" variant="secondary" size="sm" onClick={addLine}>
        + Add another ad
      </Button>

      {/* Totals — total spend + roll-up CPA across all ads. */}
      <div className="rounded-md bg-app-hover px-3 py-2 grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4">
        <div className="flex flex-col">
          <span className="text-[11px] uppercase tracking-wide text-app-fg-muted">
            Total spend ({lines.length} ad{lines.length === 1 ? '' : 's'})
          </span>
          <span className="text-base font-semibold tabular-nums">
            <NairaPrice amount={totalSpend} />
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] uppercase tracking-wide text-app-fg-muted">
            Total orders (split)
          </span>
          <span className="text-base font-semibold tabular-nums">{totalSplit}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] uppercase tracking-wide text-app-fg-muted">
            Blended CPA
          </span>
          <span className="text-base font-semibold tabular-nums">
            {totalSpend > 0 && totalSplit > 0 ? (
              <NairaPrice amount={Math.round(totalSpend / totalSplit)} />
            ) : (
              '—'
            )}
          </span>
        </div>
      </div>

      {/* Sum-vs-system mismatch hint — surfaces before submit so the MB
          knows exactly why the button is disabled. */}
      {campaignId && systemOrderCount != null && !splitMatchesSystem && (
        <p className="text-sm text-warning-700 dark:text-warning-300">
          Order split must total {systemOrderCount}. Currently splits to {totalSplit} ·{' '}
          {totalSplit > systemOrderCount
            ? `${totalSplit - systemOrderCount} too many`
            : `${systemOrderCount - totalSplit} remaining`}
          .
        </p>
      )}

      {error && <p className="text-sm text-danger-600 dark:text-danger-400">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="primary"
          onClick={handleSubmit}
          disabled={!canSubmit || busy}
          loading={busy}
        >
          {busy ? 'Submitting…' : `Submit ${lines.length} ad${lines.length === 1 ? '' : 's'}`}
        </Button>
      </div>
    </div>
  );
}
