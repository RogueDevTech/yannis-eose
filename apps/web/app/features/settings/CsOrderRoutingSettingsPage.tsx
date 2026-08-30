import { useEffect, useMemo, useRef, useState } from 'react';
import { useFetcher, useRevalidator } from '@remix-run/react';
import type { CsRoutingRelationshipMode } from '@yannis/shared';
import { PageHeader } from '~/components/ui/page-header';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { Button } from '~/components/ui/button';
import { FormSelect } from '~/components/ui/form-select';
import { Checkbox } from '~/components/ui/checkbox';
import { EmptyState } from '~/components/ui/empty-state';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { TableActionButton } from '~/components/ui/table-action-button';
import { RadioGroup } from '~/components/ui/radio-group';
import { SearchInput } from '~/components/ui/search-input';
import { useFetcherToast, useToast } from '~/components/ui/toast';
import { useCurrenciesCatalog, useHasMultipleCurrencies } from '~/contexts/currencies-catalog-context';

export interface CsRoutingRuleRow {
  id: string;
  ownerBranchId: string;
  productId: string | null;
  /** Multi-country: the country/currency this rule targets. null = any country (catch-all). */
  currencyCode?: string | null;
  priority: number;
  enabled: boolean;
  strategy: 'WEIGHTED' | 'EQUAL';
  targets: Array<{ id: string; servicingBranchId: string; teamId: string | null; weight: number }>;
}

interface BranchOpt {
  id: string;
  name: string;
  code?: string | null;
}

interface ProductOpt {
  id: string;
  name: string;
}

interface TeamOpt {
  id: string;
  label: string;
}

interface CsOrderRoutingSettingsPageProps {
  branches: BranchOpt[];
  products: ProductOpt[];
  /** CS squads keyed by branch id (optional teams when routing uses branch-wide pool). */
  teamsByBranchId: Record<string, TeamOpt[]>;
  /** One row per product (consolidated across branches; writes fan out globally). */
  rules: CsRoutingRuleRow[];
  /** Single global routing mode. */
  relationshipMode: CsRoutingRelationshipMode;
}

/**
 * Three routing methods — global, no per-branch picker:
 *   - split_all   (SPLIT_ALL_BRANCHES, default) → org-wide load-balanced pool.
 *                 Every order is dispatched to whichever Sales closer (across
 *                 ALL branches) has the lowest pending workload. Marketing
 *                 branch is irrelevant for routing (kept for attribution).
 *   - same_branch (BRANCH_DEFAULT) → marketing branch == servicing CS branch.
 *                 Lagos marketing → Lagos CS, Abuja → Abuja CS.
 *   - by_product  (PRODUCT_ALLOCATION) → per-product assignment to a servicing
 *                 branch. Same product routes the same way regardless of
 *                 which marketing branch generated the order.
 *
 * Saves fan out to every branch's `cs_order_routing_branch_settings` /
 * `cs_order_routing_rules` row server-side, so the editor presents one view of
 * the world but the underlying per-branch dispatcher keeps working unchanged.
 */
type RoutingUxMethod = 'split_all' | 'same_branch' | 'by_product';

const UX_METHOD_TO_MODE: Record<RoutingUxMethod, CsRoutingRelationshipMode> = {
  split_all: 'SPLIT_ALL_BRANCHES',
  same_branch: 'BRANCH_DEFAULT',
  by_product: 'PRODUCT_ALLOCATION',
};

function modeToUxMethod(mode: CsRoutingRelationshipMode): RoutingUxMethod {
  if (mode === 'PRODUCT_ALLOCATION') return 'by_product';
  if (mode === 'BRANCH_DEFAULT') return 'same_branch';
  return 'split_all';
}

export function CsOrderRoutingSettingsPage({
  branches,
  products,
  teamsByBranchId,
  rules,
  relationshipMode,
}: CsOrderRoutingSettingsPageProps) {
  const rev = useRevalidator();
  const toast = useToast();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const modeFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const handledSuccessRef = useRef(false);
  const handledModeSuccessRef = useRef(false);

  const initialUxMethod: RoutingUxMethod = modeToUxMethod(relationshipMode);
  const [uxMethod, setUxMethod] = useState<RoutingUxMethod>(initialUxMethod);

  useEffect(() => {
    setUxMethod(initialUxMethod);
  }, [initialUxMethod]);

  /** Local-state radio change. The product list reflects the local choice
   *  immediately so HoCS can preview / browse the catalogue, but nothing is
   *  persisted until the explicit Save button is clicked. */
  const applyUxMethod = (m: RoutingUxMethod) => {
    setUxMethod(m);
  };

  const draftMode: CsRoutingRelationshipMode = UX_METHOD_TO_MODE[uxMethod];
  const modeIsDirty = draftMode !== relationshipMode;

  /** Click handler — validates, then opens the confirm modal. */
  const requestSaveRelationshipMode = () => {
    if (!modeIsDirty) return;
    if (branches.length === 0) {
      toast.toast.error('No branches', 'Set up a branch before changing routing.');
      return;
    }
    setSaveModeConfirmOpen(true);
  };

  /** Modal confirm — fires the global mode change. The modal stays open while
   *  the request is in flight; the success/failure effect below closes it on
   *  success or surfaces the inline error on failure. */
  const confirmSaveRelationshipMode = () => {
    const fd = new FormData();
    fd.set(
      'json',
      JSON.stringify({ intent: 'setCsRoutingRelationshipMode', relationshipMode: draftMode }),
    );
    modeFetcher.submit(fd, { method: 'post' });
  };

  useFetcherToast(fetcher.data, { successMessage: 'Saved', skipErrorToast: false });
  useFetcherToast(modeFetcher.data, { successMessage: 'Routing saved', skipErrorToast: false });

  // Delete target carries the country so we remove only that country's route,
  // not every rule for the product. `currencyCode: undefined` = remove all.
  const [deleteTarget, setDeleteTarget] = useState<
    { productId: string; productName: string; currencyCode: string | null; countryLabel: string } | null
  >(null);
  const [assignConfirmOpen, setAssignConfirmOpen] = useState(false);
  const [saveModeConfirmOpen, setSaveModeConfirmOpen] = useState(false);
  /** Set when the assign flow had to save an unsaved "By product" method first.
   *  The mode-save success effect reads this to chain straight into the
   *  assignment, so one "Assign selected" click does both steps. */
  const pendingAssignAfterModeSaveRef = useRef(false);

  const [productSearch, setProductSearch] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(() => new Set());
  const [bulkServicingBranchId, setBulkServicingBranchId] = useState('');
  // Multi-currency: optional country scope for the routing rule. Only shown when
  // the company runs 2+ active currencies; '' = any country (null server-side).
  const currencies = useCurrenciesCatalog();
  const showCurrency = useHasMultipleCurrencies();
  const activeCurrencies = currencies.filter((c) => c.active);
  const [ruleCurrencyCode, setRuleCurrencyCode] = useState('');

  const branchNameById = useMemo(
    () => new Map(branches.map((b) => [b.id, b.code ? `${b.name} (${b.code})` : b.name])),
    [branches],
  );

  useEffect(() => {
    if (fetcher.state !== 'idle') {
      handledSuccessRef.current = false;
      return;
    }
    if (!fetcher.data?.success || handledSuccessRef.current) return;
    handledSuccessRef.current = true;
    setSelectedProductIds(new Set());
    setAssignConfirmOpen(false); // close confirm modal on success
    rev.revalidate();
  }, [fetcher.state, fetcher.data, rev]);

  useEffect(() => {
    if (modeFetcher.state !== 'idle') {
      handledModeSuccessRef.current = false;
      return;
    }
    if (!modeFetcher.data) return;
    if (handledModeSuccessRef.current) return;
    handledModeSuccessRef.current = true;
    if (modeFetcher.data.success) {
      setSaveModeConfirmOpen(false); // close confirm modal on success
      // Chained flow: the user clicked "Assign selected" with an unsaved
      // method. Now that the method is saved, fire the assignment (the assign
      // confirm modal is still open and shows its own in-flight state).
      if (pendingAssignAfterModeSaveRef.current) {
        pendingAssignAfterModeSaveRef.current = false;
        fireBulkProductAssign();
        // Skip revalidate here — the assignment's own success effect
        // revalidates once, after both writes land.
        return;
      }
      rev.revalidate();
    } else {
      // Save failed — abandon any chained assign so we don't fire it against a
      // stale method. Keep modal open so the inline error is visible. Revert
      // local radio state so the dirty banner reflects the still-current
      // server value if the user dismisses without retrying.
      pendingAssignAfterModeSaveRef.current = false;
      setUxMethod(modeToUxMethod(relationshipMode));
    }
  }, [modeFetcher.state, modeFetcher.data, relationshipMode, rev]);

  const busy = fetcher.state !== 'idle';
  const modeBusy = modeFetcher.state !== 'idle';

  /** Product list shows whenever the user is in by-product mode (local state).
   *  Mode auto-saves on radio change so the list is meaningful immediately. */
  const showProductStep = uxMethod === 'by_product';

  const filteredProductsForBulk = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q),
    );
  }, [products, productSearch]);

  // Multi-country: a product can carry MULTIPLE rules — one per country (plus an
  // optional any-country catch-all). Group them so the list can show every
  // "country → branch" route for a product, not just the first.
  const rulesByProductId = useMemo(() => {
    const m = new Map<string, CsRoutingRuleRow[]>();
    for (const r of rules) {
      if (!r.productId) continue;
      const list = m.get(r.productId) ?? [];
      list.push(r);
      m.set(r.productId, list);
    }
    // Stable order: any-country catch-all last, otherwise by currency code.
    for (const list of m.values()) {
      list.sort((a, b) => {
        const ca = a.currencyCode ?? '';
        const cb = b.currencyCode ?? '';
        if (!ca) return 1;
        if (!cb) return -1;
        return ca.localeCompare(cb);
      });
    }
    return m;
  }, [rules]);

  /** Country label for a rule: the country name for a currency, or "Any country". */
  const countryLabelForRule = (r: CsRoutingRuleRow): string => {
    if (!r.currencyCode) return 'Any country';
    const cur = currencies.find((c) => c.code === r.currencyCode);
    return cur?.countryName ?? r.currencyCode;
  };

  /** The (product, country) pairs already routed — used to block duplicate assigns. */
  const assignedCountryKeys = useMemo(() => {
    const s = new Set<string>();
    for (const [pid, list] of rulesByProductId) {
      for (const r of list) s.add(`${pid}::${r.currencyCode ?? ''}`);
    }
    return s;
  }, [rulesByProductId]);

  /** Products in the visible (search-filtered) list that can actually be picked:
   *  anything already routed for the selected country is disabled, so check-all
   *  must ignore those or it would report "all selected" while nothing changed. */
  const selectableVisibleProducts = useMemo(
    () =>
      filteredProductsForBulk.filter(
        (p) => !assignedCountryKeys.has(`${p.id}::${ruleCurrencyCode}`),
      ),
    [filteredProductsForBulk, assignedCountryKeys, ruleCurrencyCode],
  );
  const selectedVisibleCount = useMemo(
    () => selectableVisibleProducts.filter((p) => selectedProductIds.has(p.id)).length,
    [selectableVisibleProducts, selectedProductIds],
  );
  const allVisibleSelected =
    selectableVisibleProducts.length > 0 && selectedVisibleCount === selectableVisibleProducts.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  /** Check-all toggle: selects every selectable visible product, or clears just
   *  those (selections made under a different search stay intact). */
  const toggleAllVisible = () => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const p of selectableVisibleProducts) next.delete(p.id);
      } else {
        for (const p of selectableVisibleProducts) next.add(p.id);
      }
      return next;
    });
  };

  /** Click handler — validates inputs and opens the confirm modal. When the
   *  routing method is still an unsaved "By product" draft, we no longer block:
   *  the assign flow saves the method first, then assigns (see the mode-save
   *  success effect). One click does both. */
  const requestBulkProductAssign = () => {
    if (selectedProductIds.size === 0) {
      toast.toast.error('Select products', 'Tick at least one product to assign.');
      return;
    }
    if (!bulkServicingBranchId.trim()) {
      toast.toast.error(
        'Servicing branch required',
        'Choose which branch supplies CS for the selected products.',
      );
      return;
    }
    if (modeIsDirty && branches.length === 0) {
      toast.toast.error('No branches', 'Set up a branch before changing routing.');
      return;
    }
    setAssignConfirmOpen(true);
  };

  /** Fires the product-routing upsert. Split out so it can run either directly
   *  (method already saved) or as the second step after an auto mode-save. */
  const fireBulkProductAssign = () => {
    const fd = new FormData();
    fd.set(
      'json',
      JSON.stringify({
        intent: 'bulkUpsertProductRoutingRules',
        productIds: [...selectedProductIds],
        servicingBranchId: bulkServicingBranchId.trim(),
        teamId: null,
        // Only send when the feature is active; '' → any country (null).
        currencyCode: showCurrency ? (ruleCurrencyCode || null) : undefined,
      }),
    );
    fetcher.submit(fd, { method: 'post' });
  };

  /** Modal confirm handler. When the routing method is an unsaved "By product"
   *  draft, save the method FIRST — the mode-save success effect then chains
   *  into the assignment. Otherwise assign directly. Modal stays open while the
   *  request is in flight; the success effect below closes it on success; on
   *  failure the inline error stays visible so the user can retry. */
  const submitBulkProductAssign = () => {
    if (modeIsDirty) {
      // Two-step: persist PRODUCT_ALLOCATION, then assign on success.
      pendingAssignAfterModeSaveRef.current = true;
      confirmSaveRelationshipMode();
      return;
    }
    fireBulkProductAssign();
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const fd = new FormData();
    fd.set(
      'json',
      JSON.stringify({
        intent: 'deleteProductRouting',
        productId: deleteTarget.productId,
        // Scope the delete to this one country's rule (null = any-country rule).
        // Only sent when multi-currency is active; otherwise omit to remove all.
        ...(showCurrency ? { currencyCode: deleteTarget.currencyCode } : {}),
      }),
    );
    fetcher.submit(fd, { method: 'post' });
    setDeleteTarget(null);
  };

  const formatTargetLine = (t: CsRoutingRuleRow['targets'][0]) => {
    const b = branchNameById.get(t.servicingBranchId) ?? t.servicingBranchId;
    const teamLabel =
      t.teamId && teamsByBranchId[t.servicingBranchId]
        ? teamsByBranchId[t.servicingBranchId]!.find((x) => x.id === t.teamId)?.label ?? t.teamId
        : null;
    const narrow = teamLabel ? teamLabel : 'All Sales closers';
    return `${b} · ${narrow}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales Routing"
        description="Choose which Sales branch handles new marketing orders."
        backTo="/admin/settings"
      />

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
                1
              </span>
              Routing method
            </span>
          }
          description="Applies to every marketing branch."
        />
        <CardBody className="space-y-4">
          <RadioGroup<RoutingUxMethod>
            name="csRoutingUxMethod"
            layout="card-stack"
            value={uxMethod}
            onChange={applyUxMethod}
            options={[
              {
                value: 'split_all',
                label: 'Split across all CS branches (default)',
                description:
                  'Every order is load-balanced across CS in every branch — lowest pending wins.',
              },
              {
                value: 'same_branch',
                label: 'Same branch as marketing',
                description: 'Lagos marketing → Lagos CS. Abuja → Abuja CS. No setup.',
              },
              {
                value: 'by_product',
                label: 'By product',
                description: 'Each product is handled by the Sales branch you assign.',
              },
            ]}
          />

          {modeIsDirty ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning-200 dark:border-warning-800 bg-warning-50 dark:bg-warning-950/40 px-3 py-2">
              <p className="text-sm text-warning-700 dark:text-warning-400">
                Unsaved change — click Save to apply.
              </p>
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={modeBusy}
                loadingText="Saving…"
                disabled={modeBusy || branches.length === 0}
                onClick={requestSaveRelationshipMode}
              >
                Save
              </Button>
            </div>
          ) : null}
        </CardBody>
      </Card>

      {showProductStep ? (
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
                  2
                </span>
                Assign products
              </span>
            }
            description="Select products, choose a servicing branch, then assign."
          />
          <CardBody className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
              <div className="min-w-[min(100%,14rem)] flex-1">
                <FormSelect
                  label="Servicing branch"
                  value={bulkServicingBranchId}
                  onChange={(e) => setBulkServicingBranchId(e.target.value)}
                  options={[
                    { value: '', label: 'Choose branch…' },
                    ...branches.map((b) => ({
                      value: b.id,
                      label: b.code ? `${b.name} (${b.code})` : b.name,
                    })),
                  ]}
                />
              </div>
              {showCurrency && activeCurrencies.length > 0 ? (
                <div className="min-w-[min(100%,12rem)] flex-1">
                  <FormSelect
                    label="Country (optional)"
                    value={ruleCurrencyCode}
                    onChange={(e) => setRuleCurrencyCode(e.target.value)}
                    options={[
                      { value: '', label: 'Any country' },
                      ...activeCurrencies.map((c) => ({
                        value: c.code,
                        label: c.countryName || c.code,
                      })),
                    ]}
                  />
                </div>
              ) : null}
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={busy}
                loadingText="Saving…"
                disabled={modeBusy || branches.length === 0}
                onClick={requestBulkProductAssign}
              >
                Assign selected
              </Button>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <form onSubmit={(e) => e.preventDefault()} className="max-w-md w-full min-w-0">
                <SearchInput
                  placeholder="Search products…"
                  value={productSearch}
                  onChange={setProductSearch}
                  controlSize="sm"
                  withSubmitButton
                  wrapperClassName="w-full"
                />
              </form>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-app-fg-muted">
                  {selectedProductIds.size} selected
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedProductIds(new Set())}
                  disabled={selectedProductIds.size === 0}
                >
                  Clear
                </Button>
              </div>
            </div>

            {products.length === 0 ? (
              <EmptyState title="No products" description="Add active products to the catalog first." />
            ) : (
              <div className="max-h-[min(28rem,60vh)] overflow-y-auto rounded-lg border border-app-border divide-y divide-app-border">
                {/* Check all — toggles every selectable product currently visible. */}
                <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-app-border bg-app-elevated px-3 py-2">
                  <Checkbox
                    ref={(el) => {
                      if (el) el.indeterminate = someVisibleSelected;
                    }}
                    checked={allVisibleSelected}
                    disabled={selectableVisibleProducts.length === 0}
                    onChange={toggleAllVisible}
                    aria-label={allVisibleSelected ? 'Clear all products' : 'Select all products'}
                  />
                  <span className="text-xs font-medium text-app-fg">
                    {allVisibleSelected ? 'Clear all' : 'Select all'}
                    {selectableVisibleProducts.length > 0
                      ? ` (${selectedVisibleCount}/${selectableVisibleProducts.length})`
                      : ''}
                  </span>
                </div>
                {filteredProductsForBulk.map((p) => {
                  const productRules = rulesByProductId.get(p.id) ?? [];
                  // Blocked ONLY for the currently-selected country: a product
                  // already routed for Nigeria can still be assigned for Ghana.
                  // (Single-currency installs: ruleCurrencyCode is '' so this is
                  // the old "one route per product" behaviour.)
                  const selectedCountryTaken = assignedCountryKeys.has(`${p.id}::${ruleCurrencyCode}`);
                  return (
                    <div
                      key={p.id}
                      className={`flex flex-wrap items-start gap-3 px-3 py-2.5 ${
                        selectedCountryTaken ? 'bg-app-hover/30' : 'hover:bg-app-hover/40'
                      }`}
                    >
                      <Checkbox
                        checked={selectedProductIds.has(p.id)}
                        disabled={selectedCountryTaken}
                        onChange={() => {
                          if (selectedCountryTaken) return;
                          setSelectedProductIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(p.id)) next.delete(p.id);
                            else next.add(p.id);
                            return next;
                          });
                        }}
                        aria-label={
                          selectedCountryTaken
                            ? `${p.name} is already routed for the selected country. Remove that route to re-assign`
                            : `Select ${p.name}`
                        }
                        title={
                          selectedCountryTaken
                            ? 'Already routed for the selected country — Remove it first, or pick a different country.'
                            : undefined
                        }
                      />
                      <span
                        className="mt-0.5 min-w-0 flex-1 text-sm font-medium text-app-fg truncate"
                        title={p.name}
                      >
                        {p.name}
                      </span>
                      {/* One line per (country → branch) route. Empty = unrouted. */}
                      <div className="flex min-w-0 max-w-[18rem] flex-col items-end gap-1 sm:max-w-sm">
                        {productRules.length === 0 ? (
                          <span
                            className="text-xs italic text-warning-700 dark:text-warning-400"
                            title="No CS branch assigned — pick one and click Assign selected."
                          >
                            Not assigned
                          </span>
                        ) : (
                          productRules.map((r) => {
                            const targetLine =
                              r.targets.length > 0
                                ? r.targets.map(formatTargetLine).join(' · ')
                                : '—';
                            return (
                              <div key={r.id} className="flex items-center gap-2">
                                {showCurrency && (
                                  <span className="shrink-0 rounded-full bg-app-hover px-1.5 py-0.5 text-[10px] font-medium text-app-fg">
                                    {countryLabelForRule(r)}
                                  </span>
                                )}
                                <span
                                  className="truncate text-xs text-app-fg-muted"
                                  title={`${countryLabelForRule(r)}: ${targetLine}`}
                                >
                                  {targetLine}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDeleteTarget({
                                      productId: p.id,
                                      productName: p.name,
                                      currencyCode: r.currencyCode ?? null,
                                      countryLabel: countryLabelForRule(r),
                                    })
                                  }
                                  className="shrink-0 text-xs font-medium text-danger-600 hover:underline dark:text-danger-400"
                                  aria-label={`Remove ${countryLabelForRule(r)} route for ${p.name}`}
                                >
                                  Remove
                                </button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {filteredProductsForBulk.length === 0 && products.length > 0 ? (
              <p className="text-xs text-app-fg-muted">No matching products.</p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <ConfirmActionModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Remove product route?"
        description={
          deleteTarget
            ? showCurrency
              ? `${deleteTarget.productName} orders for ${deleteTarget.countryLabel} will be unrouted until you assign a CS branch again. Other countries' routes stay in place.`
              : `${deleteTarget.productName} will be unassigned until you assign a CS branch again.`
            : ''
        }
        confirmLabel="Remove"
        variant="danger"
        onConfirm={confirmDelete}
      />

      <ConfirmActionModal
        open={assignConfirmOpen}
        onClose={() => {
          if (busy || modeBusy) return; // block dismiss while either step is in flight
          pendingAssignAfterModeSaveRef.current = false;
          setAssignConfirmOpen(false);
        }}
        title={`Assign ${selectedProductIds.size} product${selectedProductIds.size === 1 ? '' : 's'}?`}
        description={(() => {
          const branchLabel =
            branchNameById.get(bulkServicingBranchId) ?? 'the chosen servicing branch';
          const verbing = selectedProductIds.size === 1 ? 'this product' : 'these products';
          // Multi-country: name the country this route applies to, so the user
          // knows other countries' routes for the same product are untouched.
          const countryLabel =
            showCurrency && ruleCurrencyCode
              ? currencies.find((c) => c.code === ruleCurrencyCode)?.countryName ?? ruleCurrencyCode
              : null;
          const scope = countryLabel ? ` for ${countryLabel} orders` : '';
          const base = countryLabel
            ? `${countryLabel} orders for ${verbing} will route to Sales at ${branchLabel}. Other countries' routes are unchanged; an existing ${countryLabel} route is replaced.`
            : `New orders for ${verbing}${scope} will route to Sales at ${branchLabel}. Existing routes will be replaced.`;
          // When the method is an unsaved draft, one click does both: turn on
          // by-product routing, then assign. Say so.
          return modeIsDirty
            ? `By-product routing will be turned on first, then assigned. ${base}`
            : base;
        })()}
        confirmLabel={modeIsDirty ? 'Save & assign' : 'Assign'}
        variant="warning"
        loading={busy || modeBusy}
        error={(() => {
          if (fetcher.data && !fetcher.data.success) return fetcher.data.error ?? null;
          // Surface a mode-save failure from the chained first step too.
          if (modeFetcher.data && !modeFetcher.data.success) return modeFetcher.data.error ?? null;
          return null;
        })()}
        onConfirm={submitBulkProductAssign}
      />

      <ConfirmActionModal
        open={saveModeConfirmOpen}
        onClose={() => {
          if (modeBusy) return; // block dismiss while in flight
          setSaveModeConfirmOpen(false);
        }}
        title={(() => {
          if (draftMode === 'SPLIT_ALL_BRANCHES') return 'Switch to org-wide split routing?';
          if (draftMode === 'PRODUCT_ALLOCATION') return 'Switch to per-product routing?';
          return 'Switch to same-branch routing?';
        })()}
        description={(() => {
          if (draftMode === 'SPLIT_ALL_BRANCHES') {
            return 'New marketing orders will be shared across CS in every branch. The marketing branch stays for attribution only.';
          }
          if (draftMode === 'PRODUCT_ALLOCATION') {
            return 'New marketing orders will start routing by product after save. Unassigned products fall back to the order marketing branch.';
          }
          return 'New marketing orders will stay in the same branch as the marketing funnel. Saved product routes remain and will reactivate if you switch back.';
        })()}
        confirmLabel="Save"
        variant="warning"
        loading={modeBusy}
        error={modeFetcher.data && !modeFetcher.data.success ? modeFetcher.data.error ?? null : null}
        onConfirm={confirmSaveRelationshipMode}
      />
    </div>
  );
}
