import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useActionData, useNavigation, useSubmit } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { AmountInput } from '~/components/ui/amount-input';
import { FormField } from '~/components/ui/form-field';
import { FileUpload, type FileUploadUploadState } from '~/components/ui/file-upload';
import { NairaPrice } from '~/components/ui/naira-price';
import { Spinner } from '~/components/ui/spinner';
import { S3_FOLDERS } from '~/lib/s3-upload';
import {
  fetchAdSpendIntervalPreview,
  type AdSpendIntervalPreviewResult,
} from '~/lib/trpc-browser';
import type { Campaign, Product, AdPlatform } from './types';
import { AD_EXPENSE_PLATFORM_OPTIONS } from './ad-expense-options';

interface ExpenseLine {
  uid: string;
  campaignId: string;
  productId: string;
  spendAmount: string;
  platform: AdPlatform;
  platformCustomLabel: string;
  adUrl: string;
  screenshotUrl: string;
  uploadState: FileUploadUploadState;
}

/**
 * `emptyLine` takes a uid produced by the per-component counter (see
 * `AddExpenseForm`). Module-level counters caused an SSR / CSR hydration
 * mismatch — both passes evaluate `emptyLine` in the `useState` initializer
 * but the module-level counter on the client could already be advanced from
 * earlier renders elsewhere, producing `line-2` while the server produced
 * `line-1`. A per-mount ref counter scoped under a `useId()` prefix guarantees
 * stable identifiers on both passes.
 */
function emptyLine(uid: string): ExpenseLine {
  return {
    uid,
    campaignId: '',
    productId: '',
    spendAmount: '',
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
  // `useId()` returns the same prefix on the SSR pass and the hydration pass,
  // and the per-mount counter ref also resets to 0 on each pass — so the
  // initial line gets the same uid on both, avoiding hydration mismatches on
  // every `htmlFor` / `id` / `aria-controls` derived from `line.uid`.
  const idBase = useId();
  const lineCounterRef = useRef(0);
  const newLineUid = () => `${idBase}line-${++lineCounterRef.current}`;
  const [spendDate, setSpendDate] = useState(todayYmd());
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

  const updateLine = (uid: string, patch: Partial<ExpenseLine>) => {
    setLines((rows) => {
      const idx = rows.findIndex((r) => r.uid === uid);
      if (idx === -1) return rows;
      const target = rows[idx]!;
      // Bail out when the patch already matches the row's current values —
      // returning the same `rows` reference prevents a needless re-render.
      // Defensive: catches inline-arrow callbacks (e.g. FileUpload's onUploadStateChange)
      // that fire `('idle')` on mount when the row is already 'idle'.
      const patchKeys = Object.keys(patch) as Array<keyof ExpenseLine>;
      const isNoOp = patchKeys.every((k) => target[k] === patch[k]);
      if (isNoOp) return rows;
      const next = rows.slice();
      next[idx] = { ...target, ...patch };
      return next;
    });
  };
  const addLine = () => setLines((rows) => [...rows, emptyLine(newLineUid())]);
  const removeLine = (uid: string) =>
    setLines((rows) => (rows.length === 1 ? rows : rows.filter((r) => r.uid !== uid)));

  const onCampaignChange = (uid: string, campaignId: string) => {
    const prodIds = campaignProductMap.get(campaignId) ?? [];
    const auto = prodIds.length === 1 ? prodIds[0]! : '';
    updateLine(uid, { campaignId, productId: auto });
  };

  const total = useMemo(
    () =>
      lines.reduce((acc, l) => {
        const n = Number(l.spendAmount.replace(/,/g, ''));
        return acc + (Number.isFinite(n) && n > 0 ? n : 0);
      }, 0),
    [lines],
  );

  const allLinesValid = useMemo(
    () =>
      lines.every((l) => {
        const amt = Number(l.spendAmount.replace(/,/g, ''));
        const otherOk = l.platform !== 'OTHER' || l.platformCustomLabel.trim().length > 0;
        return (
          l.campaignId &&
          l.productId &&
          l.screenshotUrl &&
          l.uploadState !== 'uploading' &&
          Number.isFinite(amt) &&
          amt > 0 &&
          otherOk
        );
      }) && spendDate.length > 0,
    [lines, spendDate],
  );

  // ── Live preview: orders + CPA per line ───────────────────────────────────
  // For each line where (campaign, product, date) are all set, hit
  // `marketing.previewAdSpendInterval` 300ms after the last keystroke. The
  // procedure returns the order count since the last APPROVED spend on
  // (campaign, product) plus an indicative CPA = spendAmount / max(orderCount,1).
  // Stored keyed by line.uid so re-ordering / removal stays correct.
  const [previewByLine, setPreviewByLine] = useState<
    Record<string, AdSpendIntervalPreviewResult | null>
  >({});
  const previewKeyByLine = useRef<Record<string, string>>({});

  useEffect(() => {
    const aborter = new AbortController();
    const timer = setTimeout(() => {
      lines.forEach((l) => {
        if (!l.campaignId || !l.productId || !spendDate) {
          previewKeyByLine.current[l.uid] = '';
          setPreviewByLine((prev) => (prev[l.uid] ? { ...prev, [l.uid]: null } : prev));
          return;
        }
        const amt = Number(l.spendAmount.replace(/,/g, ''));
        const amount = Number.isFinite(amt) && amt > 0 ? amt : undefined;
        const key = `${l.campaignId}|${l.productId}|${spendDate}|${amount ?? ''}`;
        if (previewKeyByLine.current[l.uid] === key) return;
        previewKeyByLine.current[l.uid] = key;
        fetchAdSpendIntervalPreview({
          campaignId: l.campaignId,
          productId: l.productId,
          spendDate,
          spendAmount: amount,
        }).then((result) => {
          if (aborter.signal.aborted) return;
          setPreviewByLine((prev) => ({ ...prev, [l.uid]: result }));
        });
      });
    }, 300);
    return () => {
      aborter.abort();
      clearTimeout(timer);
    };
  }, [lines, spendDate]);

  /** Aggregate roll-up for the totals footer. Dedupe by (campaign, product, date)
   * so two lines targeting the same campaign×product on the same day don't
   * double-count the same order window. CPA = totalSpend / totalUniqueOrders. */
  const summary = useMemo(() => {
    const seen = new Set<string>();
    let totalOrders = 0;
    let hasAnyPreview = false;
    for (const l of lines) {
      const preview = previewByLine[l.uid];
      if (!preview) continue;
      hasAnyPreview = true;
      const tupleKey = `${l.campaignId}|${l.productId}|${spendDate}`;
      if (seen.has(tupleKey)) continue;
      seen.add(tupleKey);
      totalOrders += preview.orderCount;
    }
    return {
      totalOrders: hasAnyPreview ? totalOrders : null,
      indicativeCpa:
        hasAnyPreview && totalOrders > 0 && total > 0 ? total / totalOrders : null,
    };
  }, [lines, previewByLine, spendDate, total]);

  const handleSubmit = () => {
    if (!allLinesValid) return;
    const payload = lines.map((l) => {
      const base = {
        campaignId: l.campaignId,
        productId: l.productId,
        spendAmount: Number(l.spendAmount.replace(/,/g, '')),
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
    fd.set('lines', JSON.stringify(payload));
    submit(fd, { method: 'post' });
  };

  const error = actionData?.error;
  const busy = navigation.state === 'submitting';

  return (
    <div className="space-y-3">
      <div className="max-w-xs">
        <FormField label="Date" htmlFor="add-expense-date">
          <TextInput
            id="add-expense-date"
            type="date"
            value={spendDate}
            onChange={(e) => setSpendDate(e.target.value)}
            max={todayYmd()}
          />
        </FormField>
      </div>

      <div className="space-y-2">
        {lines.map((line, idx) => {
          const productOptionsForLine =
            line.campaignId && (campaignProductMap.get(line.campaignId)?.length ?? 0) > 0
              ? productOptions.filter((p) => campaignProductMap.get(line.campaignId)!.includes(p.value))
              : productOptions;
          return (
            <div
              key={line.uid}
              className="rounded-lg border border-app-border bg-app-elevated px-3 py-2.5 space-y-2"
            >
              {/* Compact header — ad row label + Remove on the right. */}
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
              {/* Two-row, 3-up layout per CEO directive 2026-05-03:
                    Row 1: Campaign · Product · Amount
                    Row 2: Platform · Ad URL · Screenshot (compact dropzone)
                  Falls back to 2-col on sm and 1-col on mobile. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                <FormField label="Campaign" htmlFor={`${line.uid}-campaign`} required>
                  <SearchableSelect
                    id={`${line.uid}-campaign`}
                    value={line.campaignId}
                    onChange={(v) => onCampaignChange(line.uid, v)}
                    options={[
                      { value: '', label: 'Select campaign' },
                      ...campaigns.map((c) => ({ value: c.id, label: c.name })),
                    ]}
                    searchPlaceholder="Search campaigns..."
                    required
                  />
                </FormField>
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
              {/* Per-line preview row — orders since last APPROVED spend on
                  (this campaign × this product) plus indicative CPA for the
                  line's spend amount. Lights up 300ms after campaign+product
                  are picked; otherwise prompts the buyer to pick them. */}
              {(() => {
                const preview = previewByLine[line.uid];
                const ready = !!line.campaignId && !!line.productId && !!spendDate;
                return (
                  <div className="grid grid-cols-2 gap-3 rounded-md bg-app-hover/60 px-3 py-2 mt-1">
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase tracking-wide text-app-fg-muted">
                        Orders (since last spend)
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-app-fg inline-flex items-center gap-1.5">
                        {!ready ? (
                          'Pick campaign + product'
                        ) : preview ? (
                          preview.orderCount
                        ) : (
                          <>
                            Calculating <Spinner size="sm" className="text-app-fg-muted" />
                          </>
                        )}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase tracking-wide text-app-fg-muted">
                        Indicative CPA (this line)
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-app-fg inline-flex items-center gap-1.5">
                        {!ready ? (
                          '—'
                        ) : preview && preview.indicativeCpa != null ? (
                          <NairaPrice amount={Math.round(preview.indicativeCpa)} />
                        ) : preview ? (
                          '—'
                        ) : (
                          <>
                            Calculating <Spinner size="sm" className="text-app-fg-muted" />
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      <Button type="button" variant="secondary" size="sm" onClick={addLine}>
        + Add another line
      </Button>

      {/* Totals — spend + live order count and indicative CPA. Order rollup
          dedupes by (campaign, product, date) so two lines for the same key
          don't double-count the same order window. */}
      <div className="rounded-md bg-app-hover px-3 py-2 grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4">
        <div className="flex flex-col">
          <span className="text-[11px] uppercase tracking-wide text-app-fg-muted">
            Total spend ({lines.length} line{lines.length === 1 ? '' : 's'})
          </span>
          <span className="text-base font-semibold tabular-nums">
            <NairaPrice amount={total} />
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] uppercase tracking-wide text-app-fg-muted">
            Order count
          </span>
          <span className="text-base font-semibold tabular-nums">
            {summary.totalOrders != null ? summary.totalOrders : '—'}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] uppercase tracking-wide text-app-fg-muted">
            Indicative CPA
          </span>
          <span className="text-base font-semibold tabular-nums">
            {summary.indicativeCpa != null ? (
              <NairaPrice amount={Math.round(summary.indicativeCpa)} />
            ) : (
              '—'
            )}
          </span>
        </div>
      </div>

      {error && <p className="text-sm text-danger-600 dark:text-danger-400">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="primary"
          onClick={handleSubmit}
          disabled={!allLinesValid || busy}
          loading={busy}
        >
          {busy ? 'Submitting…' : `Submit ${lines.length} line${lines.length === 1 ? '' : 's'}`}
        </Button>
      </div>
    </div>
  );
}
