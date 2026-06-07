import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useActionData, useLocation, useNavigate, useNavigation } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import { NumberInput } from '~/components/ui/number-input';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { AmountInput } from '~/components/ui/amount-input';
import { FormField } from '~/components/ui/form-field';
import { NairaPrice } from '~/components/ui/naira-price';
import { Spinner } from '~/components/ui/spinner';
import { fetchCampaignOrderTotalForBatch } from '~/lib/trpc-browser';
import type { Campaign, Product, AdPlatform, ExpenseCategory } from './types';
import { AD_EXPENSE_PLATFORM_OPTIONS } from './ad-expense-options';
import { EXPENSE_CATEGORY_OPTIONS } from './expense-category-options';

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
}

interface FormSection {
  uid: string;
  campaignId: string;
  lines: ExpenseLine[];
}

function emptyLine(uid: string): ExpenseLine {
  return {
    uid,
    productId: '',
    spendAmount: '',
    attributedOrderCount: '',
    platform: 'FACEBOOK',
    platformCustomLabel: '',
  };
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface AddExpenseFormProps {
  picklistsPromise:
    | Promise<{ campaigns: Campaign[]; products: Product[] }>
    | { campaigns: Campaign[]; products: Product[] };
}

function isResolvedPicklists<T>(v: T | Promise<T>): v is T {
  return typeof v === 'object' && v != null && !('then' in (v as object));
}

export function AddExpenseForm({ picklistsPromise }: AddExpenseFormProps) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(
    isResolvedPicklists(picklistsPromise) ? picklistsPromise.campaigns : null,
  );
  const [products, setProducts] = useState<Product[] | null>(
    isResolvedPicklists(picklistsPromise) ? picklistsPromise.products : null,
  );
  useEffect(() => {
    if (isResolvedPicklists(picklistsPromise)) {
      setCampaigns(picklistsPromise.campaigns);
      setProducts(picklistsPromise.products);
      return;
    }
    let cancelled = false;
    Promise.resolve(picklistsPromise)
      .then((p) => {
        if (cancelled) return;
        setCampaigns(p.campaigns);
        setProducts(p.products);
      })
      .catch(() => {
        if (cancelled) return;
        setCampaigns([]);
        setProducts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [picklistsPromise]);

  const navigation = useNavigation();
  const navigate = useNavigate();
  const location = useLocation();
  const actionData = useActionData<{ error?: string } | undefined>();
  const idBase = useId();
  const counterRef = useRef(0);
  const newUid = (prefix: string) => `${idBase}${prefix}-${++counterRef.current}`;

  // One date for the whole submission — every form + ad under it shares this
  // date (CEO directive 2026-05-10). Logging is a "today's spend" workflow.
  const [spendDate, setSpendDate] = useState(todayYmd());
  const [category, setCategory] = useState<ExpenseCategory>('AD_SPEND');
  // Simplified form state for non-AD_SPEND categories (amount + description only).
  const [simpleAmount, setSimpleAmount] = useState('');
  const [simpleDescription, setSimpleDescription] = useState('');

  const [forms, setForms] = useState<FormSection[]>(() => [
    {
      uid: newUid('form'),
      campaignId: '',
      lines: [emptyLine(newUid('line'))],
    },
  ]);

  // Per-form (campaignId, spendDate) → system order count snapshot.
  // Lifted to the parent so each FormSection child only needs to read it,
  // and so canSubmit / grand totals can use it across all sections.
  const [systemCounts, setSystemCounts] = useState<Record<string, { count: number | null; loading: boolean }>>({});
  const updateSystemCount = useCallback(
    (uid: string, patch: { count?: number | null; loading?: boolean }) => {
      setSystemCounts((prev) => ({ ...prev, [uid]: { ...prev[uid], count: prev[uid]?.count ?? null, loading: prev[uid]?.loading ?? false, ...patch } }));
    },
    [],
  );

  const productOptions = useMemo(
    () => (products ?? []).map((p) => ({ value: p.id, label: p.name })),
    [products],
  );

  const campaignProductMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of (campaigns ?? [])) {
      if (Array.isArray(c.productIds) && c.productIds.length > 0) {
        m.set(c.id, c.productIds.filter((id): id is string => typeof id === 'string' && id.length > 0));
      }
    }
    return m;
  }, [campaigns]);

  const addForm = () =>
    setForms((prev) => [
      ...prev,
      {
        uid: newUid('form'),
        campaignId: '',
        lines: [emptyLine(newUid('line'))],
      },
    ]);

  const removeForm = (uid: string) =>
    setForms((prev) => (prev.length === 1 ? prev : prev.filter((f) => f.uid !== uid)));

  const onCampaignChange = (formUid: string, nextCampaignId: string) => {
    setForms((prev) =>
      prev.map((f) => {
        if (f.uid !== formUid) return f;
        const allowed = campaignProductMap.get(nextCampaignId) ?? [];
        // The MB knows the form they picked covers a known product set, so we
        // pre-fill every line with the first allowed product. Multi-product
        // forms still let them switch — this just saves a tap when only one
        // applies and a sane default when several do.
        const defaultProduct = allowed[0] ?? '';
        return {
          ...f,
          campaignId: nextCampaignId,
          lines: f.lines.map((r) => {
            if (allowed.length === 0) return r;
            if (r.productId && allowed.includes(r.productId)) return r;
            return { ...r, productId: defaultProduct };
          }),
        };
      }),
    );
  };

  const updateLine = (formUid: string, lineUid: string, patch: Partial<ExpenseLine>) => {
    setForms((prev) =>
      prev.map((f) => {
        if (f.uid !== formUid) return f;
        const idx = f.lines.findIndex((r) => r.uid === lineUid);
        if (idx === -1) return f;
        const target = f.lines[idx]!;
        const isNoOp = (Object.keys(patch) as Array<keyof ExpenseLine>).every((k) => target[k] === patch[k]);
        if (isNoOp) return f;
        const next = f.lines.slice();
        next[idx] = { ...target, ...patch };
        return { ...f, lines: next };
      }),
    );
  };

  const addLine = (formUid: string) => {
    setForms((prev) =>
      prev.map((f) => {
        if (f.uid !== formUid) return f;
        const allowed = campaignProductMap.get(f.campaignId) ?? [];
        // Default to the form's first product so the new line is workable on
        // sight (multi-product forms — the MB can change it on the new line).
        const defaultProduct = allowed[0] ?? '';
        return { ...f, lines: [...f.lines, { ...emptyLine(newUid('line')), productId: defaultProduct }] };
      }),
    );
  };

  const removeLine = (formUid: string, lineUid: string) => {
    setForms((prev) =>
      prev.map((f) =>
        f.uid !== formUid
          ? f
          : { ...f, lines: f.lines.length === 1 ? f.lines : f.lines.filter((r) => r.uid !== lineUid) },
      ),
    );
  };

  const formValidities = useMemo(
    () =>
      forms.map((f) => {
        if (!spendDate || !f.campaignId) return { valid: false, splitMatchesSystem: false, totalSplit: 0, totalSpend: 0 };
        const totalSplit = f.lines.reduce((acc, l) => {
          const n = parseInt(l.attributedOrderCount, 10);
          return acc + (Number.isFinite(n) && n >= 0 ? n : 0);
        }, 0);
        const totalSpend = f.lines.reduce((acc, l) => {
          const n = Number(l.spendAmount.replace(/,/g, ''));
          return acc + (Number.isFinite(n) && n > 0 ? n : 0);
        }, 0);
        const sysCount = systemCounts[f.uid]?.count ?? null;
        const splitMatchesSystem = sysCount != null && totalSplit === sysCount;
        const linesValid = f.lines.every((l) => {
          const amt = Number(l.spendAmount.replace(/,/g, ''));
          const orders = parseInt(l.attributedOrderCount, 10);
          const otherOk = l.platform !== 'OTHER' || l.platformCustomLabel.trim().length > 0;
          return (
            l.productId &&
            Number.isFinite(amt) &&
            amt > 0 &&
            Number.isFinite(orders) &&
            orders >= 0 &&
            otherOk
          );
        });
        return { valid: linesValid && splitMatchesSystem, splitMatchesSystem, totalSplit, totalSpend };
      }),
    [forms, systemCounts, spendDate],
  );

  const canSubmit = forms.length > 0 && formValidities.every((v) => v.valid);

  const grandTotalSpend = useMemo(
    () => formValidities.reduce((acc, v) => acc + v.totalSpend, 0),
    [formValidities],
  );
  const grandTotalSplit = useMemo(
    () => formValidities.reduce((acc, v) => acc + v.totalSplit, 0),
    [formValidities],
  );
  const grandTotalLines = useMemo(() => forms.reduce((acc, f) => acc + f.lines.length, 0), [forms]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (submitting) return;

    // Simplified flow for non-AD_SPEND categories
    if (category !== 'AD_SPEND') {
      const amt = Number(simpleAmount.replace(/,/g, '').trim());
      if (!amt || amt <= 0) return;
      setSubmitting(true);
      setSubmitError(null);
      const fd = new FormData();
      fd.set('intent', 'createSimpleExpense');
      fd.set('spendDate', spendDate);
      fd.set('category', category);
      fd.set('spendAmount', String(amt));
      if (simpleDescription.trim()) fd.set('description', simpleDescription.trim());
      try {
        const res = await fetch(location.pathname, { method: 'POST', body: fd });
        const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
        if (!res.ok || !body.success) {
          setSubmitError(body.error ?? 'Submission failed');
          setSubmitting(false);
          return;
        }
      } catch {
        setSubmitError('Network error');
        setSubmitting(false);
        return;
      }
      navigate('/admin/marketing/expenses');
      return;
    }

    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);

    for (const [idx, form] of forms.entries()) {
      const payload = form.lines.map((l) => {
        const base = {
          productId: l.productId,
          spendAmount: Number(l.spendAmount.replace(/,/g, '')),
          attributedOrderCount: parseInt(l.attributedOrderCount, 10),
          platform: l.platform,
          category: 'AD_SPEND' as const,
        };
        if (l.platform === 'OTHER' && l.platformCustomLabel.trim()) {
          return { ...base, platformCustomLabel: l.platformCustomLabel.trim() };
        }
        return base;
      });
      const fd = new FormData();
      fd.set('intent', 'createAdSpendBatch');
      fd.set('spendDate', spendDate);
      fd.set('campaignId', form.campaignId);
      fd.set('lines', JSON.stringify(payload));

      try {
        const res = await fetch(location.pathname, { method: 'POST', body: fd });
        const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
        if (!res.ok || !body.success) {
          setSubmitError(`Form ${idx + 1}: ${body.error ?? 'Submission failed'}`);
          setSubmitting(false);
          return;
        }
      } catch {
        setSubmitError(`Form ${idx + 1}: Network error`);
        setSubmitting(false);
        return;
      }
    }

    navigate('/admin/marketing/expenses');
  };

  const error = submitError ?? actionData?.error;
  const busy = submitting || navigation.state === 'submitting';

  const simpleCanSubmit = category !== 'AD_SPEND' && (() => {
    const t = simpleAmount.replace(/,/g, '').trim();
    if (t === '') return false;
    const n = Number(t);
    if (Number.isNaN(n) || n <= 0) return false;
    if (category === 'OTHER' && !simpleDescription.trim()) return false;
    return true;
  })();

  return (
    <div className="space-y-4">
      {/* Category + date row */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <FormField label="Category" htmlFor="add-expense-category" required className="sm:w-56">
          <FormSelect
            id="add-expense-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            options={EXPENSE_CATEGORY_OPTIONS}
          />
        </FormField>
        <FormField label="Date" htmlFor="add-expense-date" required className="sm:w-56">
          <TextInput
            id="add-expense-date"
            type="date"
            value={spendDate}
            onChange={(e) => setSpendDate(e.target.value)}
            max={todayYmd()}
          />
        </FormField>
      </div>

      {/* Simplified form for non-AD_SPEND categories */}
      {category !== 'AD_SPEND' && (
        <div className="card !p-4 space-y-3">
          <p className="text-sm font-medium text-app-fg">
            {EXPENSE_CATEGORY_OPTIONS.find((o) => o.value === category)?.label} expense
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Amount" htmlFor="simple-expense-amount" required>
              <AmountInput
                id="simple-expense-amount"
                value={simpleAmount}
                onChange={setSimpleAmount}
                placeholder="0.00"
              />
            </FormField>
            <FormField label="Description" htmlFor="simple-expense-desc" required={category === 'OTHER'}>
              <TextInput
                id="simple-expense-desc"
                value={simpleDescription}
                onChange={(e) => setSimpleDescription(e.target.value)}
                placeholder={category === 'OTHER' ? 'What exactly was purchased?' : 'What was this expense for?'}
                required={category === 'OTHER'}
              />
            </FormField>
          </div>

          {error && (
            <p className="text-sm text-danger-600 dark:text-danger-400">{error}</p>
          )}

          <Button
            type="button"
            variant="primary"
            onClick={handleSubmit}
            disabled={!simpleCanSubmit || busy}
          >
            {busy ? <><Spinner className="w-4 h-4" /> Submitting…</> : 'Submit expense'}
          </Button>
        </div>
      )}

      {/* Full Ad Spend form (only when category is AD_SPEND) */}
      {category === 'AD_SPEND' && (
        <>
      {forms.map((form, idx) => (
        <FormSectionCard
          key={form.uid}
          form={form}
          index={idx}
          spendDate={spendDate}
          campaigns={campaigns}
          productOptions={productOptions}
          campaignProductMap={campaignProductMap}
          systemCount={systemCounts[form.uid]?.count ?? null}
          systemLoading={systemCounts[form.uid]?.loading ?? false}
          onSystemCountChange={(patch) => updateSystemCount(form.uid, patch)}
          totals={formValidities[idx] ?? { totalSpend: 0, totalSplit: 0, splitMatchesSystem: false, valid: false }}
          onCampaignChange={(v) => onCampaignChange(form.uid, v)}
          onLineChange={(lineUid, patch) => updateLine(form.uid, lineUid, patch)}
          onAddLine={() => addLine(form.uid)}
          onRemoveLine={(lineUid) => removeLine(form.uid, lineUid)}
          onRemoveForm={forms.length > 1 ? () => removeForm(form.uid) : null}
        />
      ))}

      {/* Distinct CTA — full-width dashed brand-tinted button so it's visually
          separate from the per-form "+ Add ad" secondary buttons. */}
      <button
        type="button"
        onClick={addForm}
        className="w-full flex items-center justify-center gap-2 h-11 rounded-lg border-2 border-dashed border-brand-300 dark:border-brand-700 bg-brand-50/50 dark:bg-brand-900/10 text-sm font-semibold text-brand-700 dark:text-brand-300 hover:border-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Add another form
      </button>

      {/* Grand totals across all forms. */}
      <div className="rounded-md bg-app-hover px-3 py-2 grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4">
        <div className="flex flex-col">
          <span className="text-mini uppercase tracking-wide text-app-fg-muted">
            Total spend ({grandTotalLines} ad{grandTotalLines === 1 ? '' : 's'} · {forms.length} form{forms.length === 1 ? '' : 's'})
          </span>
          <span className="text-base font-semibold tabular-nums">
            <NairaPrice amount={grandTotalSpend} />
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-mini uppercase tracking-wide text-app-fg-muted">
            Total orders (split)
          </span>
          <span className="text-base font-semibold tabular-nums">{grandTotalSplit}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-mini uppercase tracking-wide text-app-fg-muted">
            Blended CPA
          </span>
          <span className="text-base font-semibold tabular-nums">
            {grandTotalSpend > 0 && grandTotalSplit > 0 ? (
              <NairaPrice amount={Math.round(grandTotalSpend / grandTotalSplit)} />
            ) : (
              '—'
            )}
          </span>
        </div>
      </div>

      {error && <p className="text-sm text-danger-600 dark:text-danger-400">{error}</p>}

      {/* Concrete blocking-issue summary so the MB knows exactly what to fix
          before submit. Listing per-form issues beats a generic "fix errors". */}
      {!canSubmit && !busy && (() => {
        const issues: string[] = [];
        forms.forEach((f, idx) => {
          const v = formValidities[idx];
          if (!v) return;
          if (!f.campaignId) {
            issues.push(`Form ${idx + 1}: pick a form`);
            return;
          }
          const sys = systemCounts[f.uid]?.count;
          if (sys != null && !v.splitMatchesSystem) {
            issues.push(
              `Form ${idx + 1}: order split must total ${sys} (currently ${v.totalSplit})`,
            );
            return;
          }
          if (sys == null) {
            issues.push(`Form ${idx + 1}: waiting for system order count`);
            return;
          }
          if (!v.valid) {
            issues.push(`Form ${idx + 1}: complete required fields (Product, Amount)`);
          }
        });
        if (issues.length === 0) return null;
        return (
          <div className="rounded-md border border-warning-300 dark:border-warning-700/50 bg-warning-50 dark:bg-warning-900/20 px-3 py-2 text-sm text-warning-800 dark:text-warning-300 space-y-0.5">
            <p className="font-semibold">Cannot submit yet:</p>
            <ul className="list-disc list-inside space-y-0.5">
              {issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          </div>
        );
      })()}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="primary"
          onClick={handleSubmit}
          disabled={!canSubmit || busy}
          loading={busy}
          className={!canSubmit && !busy ? 'cursor-not-allowed opacity-60' : undefined}
        >
          {busy
            ? 'Submitting…'
            : `Submit ${grandTotalLines} ad${grandTotalLines === 1 ? '' : 's'} across ${forms.length} form${forms.length === 1 ? '' : 's'}`}
        </Button>
      </div>
        </>
      )}
    </div>
  );
}

interface FormSectionCardProps {
  form: FormSection;
  index: number;
  spendDate: string;
  campaigns: Campaign[] | null;
  productOptions: { value: string; label: string }[];
  campaignProductMap: Map<string, string[]>;
  systemCount: number | null;
  systemLoading: boolean;
  onSystemCountChange: (patch: { count?: number | null; loading?: boolean }) => void;
  totals: { totalSpend: number; totalSplit: number; splitMatchesSystem: boolean; valid: boolean };
  onCampaignChange: (id: string) => void;
  onLineChange: (lineUid: string, patch: Partial<ExpenseLine>) => void;
  onAddLine: () => void;
  onRemoveLine: (lineUid: string) => void;
  onRemoveForm: (() => void) | null;
}

function FormSectionCard({
  form,
  index,
  spendDate,
  campaigns,
  productOptions,
  campaignProductMap,
  systemCount,
  systemLoading,
  onSystemCountChange,
  totals,
  onCampaignChange,
  onLineChange,
  onAddLine,
  onRemoveLine,
  onRemoveForm,
}: FormSectionCardProps) {
  // System count fetch — debounced 300ms after (campaign, top-level date) settle.
  const lastKeyRef = useRef('');
  useEffect(() => {
    if (!form.campaignId || !spendDate) {
      lastKeyRef.current = '';
      onSystemCountChange({ count: null, loading: false });
      return;
    }
    const key = `${form.campaignId}|${spendDate}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;
    onSystemCountChange({ loading: true });
    const aborter = new AbortController();
    const timer = setTimeout(() => {
      fetchCampaignOrderTotalForBatch({ campaignId: form.campaignId, spendDate })
        .then((result) => {
          if (aborter.signal.aborted) return;
          onSystemCountChange({ count: result?.orderCount ?? 0, loading: false });
        })
        .catch(() => {
          if (aborter.signal.aborted) return;
          onSystemCountChange({ loading: false });
        });
    }, 300);
    return () => {
      aborter.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.campaignId, spendDate]);

  const productOptionsForForm = useMemo(() => {
    if (!form.campaignId) return productOptions;
    const allowed = campaignProductMap.get(form.campaignId) ?? [];
    if (allowed.length === 0) return productOptions;
    return productOptions.filter((p) => allowed.includes(p.value));
  }, [productOptions, campaignProductMap, form.campaignId]);

  const remaining = systemCount != null ? systemCount - totals.totalSplit : null;

  return (
    <div className="rounded-lg border border-app-border bg-app-elevated px-3 py-3 space-y-3">
      {/* Form header — title + remove. Remove is danger-styled so it stands
          apart from the secondary "+ Add ad" button at the bottom of the card. */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold text-app-fg-muted uppercase tracking-wide pt-1.5">
          Form {index + 1}
        </span>
        {onRemoveForm && (
          <button
            type="button"
            onClick={onRemoveForm}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-danger-300 dark:border-danger-700 bg-danger-50 dark:bg-danger-900/20 text-xs font-semibold text-danger-700 dark:text-danger-300 hover:bg-danger-100 dark:hover:bg-danger-900/30 hover:border-danger-500 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Remove form
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        <FormField label="Form (campaign)" htmlFor={`${form.uid}-campaign`} required>
          <SearchableSelect
            id={`${form.uid}-campaign`}
            value={form.campaignId}
            onChange={onCampaignChange}
            options={
              campaigns === null
                ? []
                : [
                    { value: '', label: 'Select form' },
                    ...campaigns.map((c) => ({ value: c.id, label: c.name })),
                  ]
            }
            placeholder={campaigns === null ? 'Loading forms…' : undefined}
            searchPlaceholder="Search forms..."
            required
            disabled={campaigns === null}
          />
        </FormField>
        <FormField label="System count" htmlFor={`${form.uid}-syscount`}>
          <div
            id={`${form.uid}-syscount`}
            className="h-9 px-2 inline-flex items-center text-sm font-semibold tabular-nums rounded-md border border-app-border bg-app-hover text-app-fg"
          >
            {!form.campaignId ? (
              <span className="text-app-fg-muted font-normal">Pick a form</span>
            ) : systemLoading ? (
              <>
                <Spinner size="sm" className="text-app-fg-muted" />
              </>
            ) : systemCount != null ? (
              systemCount
            ) : (
              '—'
            )}
          </div>
        </FormField>
        <FormField label="Split / Remaining" htmlFor={`${form.uid}-split`}>
          <div
            id={`${form.uid}-split`}
            className="h-9 px-2 inline-flex items-center gap-2 text-sm font-semibold tabular-nums rounded-md border border-app-border bg-app-hover"
          >
            <span
              className={
                totals.splitMatchesSystem
                  ? 'text-success-600 dark:text-success-400'
                  : systemCount != null
                    ? 'text-warning-600 dark:text-warning-400'
                    : 'text-app-fg'
              }
            >
              {totals.totalSplit}
            </span>
            <span className="text-app-fg-muted">/</span>
            <span className="text-app-fg-muted">{remaining == null ? '—' : remaining}</span>
          </div>
        </FormField>
      </div>

      {/* Tabular ads — column headers at top, each ad is a row. */}
      <div className="overflow-x-auto -mx-3 sm:mx-0">
        <table className="min-w-full border-separate border-spacing-y-1 px-3 sm:px-0">
          <thead>
            <tr className="text-left">
              <th className="px-1.5 pb-1 text-micro font-semibold uppercase tracking-wide text-app-fg-muted w-10">
                #
              </th>
              <th className="px-1.5 pb-1 text-micro font-semibold uppercase tracking-wide text-app-fg-muted min-w-[200px]">
                Product*
              </th>
              <th className="px-1.5 pb-1 text-micro font-semibold uppercase tracking-wide text-app-fg-muted min-w-[120px]">
                Amount (₦)*
              </th>
              <th className="px-1.5 pb-1 text-micro font-semibold uppercase tracking-wide text-app-fg-muted min-w-[90px]">
                Orders*
              </th>
              <th className="px-1.5 pb-1 text-micro font-semibold uppercase tracking-wide text-app-fg-muted min-w-[130px]">
                Platform*
              </th>
              <th className="px-1.5 pb-1 text-micro font-semibold uppercase tracking-wide text-app-fg-muted min-w-[90px] text-right">
                CPA
              </th>
              <th className="px-1.5 pb-1 w-10" aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {form.lines.map((line, lineIdx) => {
              const lineSpend = Number(line.spendAmount.replace(/,/g, ''));
              const lineOrders = parseInt(line.attributedOrderCount, 10);
              const lineCpa =
                Number.isFinite(lineSpend) && lineSpend > 0 && Number.isFinite(lineOrders) && lineOrders > 0
                  ? lineSpend / lineOrders
                  : null;
              const showCustomPlatform = line.platform === 'OTHER';
              return (
                <Fragment key={line.uid}>
                  <tr className="align-top">
                    <td className="px-1.5 py-1 text-xs font-semibold text-app-fg-muted tabular-nums">
                      {lineIdx + 1}
                    </td>
                    <td className="px-1.5 py-1">
                      <SearchableSelect
                        id={`${line.uid}-product`}
                        value={line.productId}
                        onChange={(v) => onLineChange(line.uid, { productId: v })}
                        options={[{ value: '', label: 'Select product' }, ...productOptionsForForm]}
                        searchPlaceholder="Search products..."
                        required
                      />
                    </td>
                    <td className="px-1.5 py-1">
                      <AmountInput
                        id={`${line.uid}-amount`}
                        value={line.spendAmount}
                        onChange={(v) => onLineChange(line.uid, { spendAmount: v })}
                        placeholder="0.00"
                        required
                        className="w-full h-9 px-3 text-sm rounded-lg border border-app-border bg-app-canvas text-app-fg placeholder:text-app-fg-muted focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 transition-colors"
                      />
                    </td>
                    <td className="px-1.5 py-1">
                      <NumberInput
                        id={`${line.uid}-orders`}
                        min={0}
                        fallbackValue={0}
                        value={
                          line.attributedOrderCount === ''
                            ? 0
                            : Number(line.attributedOrderCount) || 0
                        }
                        onValueChange={(n) => onLineChange(line.uid, { attributedOrderCount: String(n) })}
                      />
                    </td>
                    <td className="px-1.5 py-1">
                      <FormSelect
                        id={`${line.uid}-platform`}
                        value={line.platform}
                        onChange={(e) => {
                          const v = e.target.value as AdPlatform;
                          onLineChange(line.uid, {
                            platform: v,
                            platformCustomLabel: v === 'OTHER' ? line.platformCustomLabel : '',
                          });
                        }}
                        options={AD_EXPENSE_PLATFORM_OPTIONS}
                        required
                      />
                    </td>
                    <td className="px-1.5 py-1 text-sm font-semibold tabular-nums text-app-fg text-right whitespace-nowrap">
                      {lineCpa != null ? <NairaPrice amount={Math.round(lineCpa)} /> : '—'}
                    </td>
                    <td className="px-1.5 py-1 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onRemoveLine(line.uid)}
                        disabled={form.lines.length === 1}
                        aria-label="Remove ad"
                      >
                        ×
                      </Button>
                    </td>
                  </tr>
                  {showCustomPlatform && (
                    <tr>
                      <td />
                      <td colSpan={6} className="px-1.5 pb-1">
                        <FormField
                          label={`Ad ${lineIdx + 1} platform name`}
                          htmlFor={`${line.uid}-platform-custom`}
                          required
                        >
                          <TextInput
                            id={`${line.uid}-platform-custom`}
                            value={line.platformCustomLabel}
                            onChange={(e) => onLineChange(line.uid, { platformCustomLabel: e.target.value })}
                            placeholder="e.g. Snapchat, Taboola"
                            maxLength={80}
                            required
                          />
                        </FormField>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onAddLine}>
          + Add ad to form {index + 1}
        </Button>
        {/* Per-form mismatch hint surfaces inline so the MB knows why submit is gated. */}
        {form.campaignId && systemCount != null && !totals.splitMatchesSystem && (
          <p className="text-xs text-warning-700 dark:text-warning-300">
            Order split must total {systemCount}. Currently {totals.totalSplit} ·{' '}
            {totals.totalSplit > systemCount
              ? `${totals.totalSplit - systemCount} too many`
              : `${systemCount - totals.totalSplit} remaining`}
            .
          </p>
        )}
      </div>

    </div>
  );
}
