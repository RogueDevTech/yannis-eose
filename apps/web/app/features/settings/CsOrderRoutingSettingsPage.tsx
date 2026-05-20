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

export interface CsRoutingRuleRow {
  id: string;
  ownerBranchId: string;
  productId: string | null;
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

  const [deleteProductId, setDeleteProductId] = useState<string | null>(null);
  const [assignConfirmOpen, setAssignConfirmOpen] = useState(false);
  const [saveModeConfirmOpen, setSaveModeConfirmOpen] = useState(false);

  const [productSearch, setProductSearch] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(() => new Set());
  const [bulkServicingBranchId, setBulkServicingBranchId] = useState('');

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
      rev.revalidate();
    } else {
      // Save failed — keep modal open so the inline error is visible. Revert
      // local radio state so the dirty banner reflects the still-current
      // server value if the user dismisses without retrying.
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

  const ruleByProductId = useMemo(() => {
    const m = new Map<string, CsRoutingRuleRow>();
    for (const r of rules) {
      if (r.productId) m.set(r.productId, r);
    }
    return m;
  }, [rules]);

  /** Click handler — validates inputs and opens the confirm modal. */
  const requestBulkProductAssign = () => {
    if (modeIsDirty) {
      toast.toast.error('Save routing method first', 'Click Save above before assigning products.');
      return;
    }
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
    setAssignConfirmOpen(true);
  };

  /** Modal confirm handler — fires the upsert. Modal stays open while the
   *  request is in flight; the success effect below closes it on success;
   *  on failure the inline error stays visible so the user can retry. */
  const submitBulkProductAssign = () => {
    const fd = new FormData();
    fd.set(
      'json',
      JSON.stringify({
        intent: 'bulkUpsertProductRoutingRules',
        productIds: [...selectedProductIds],
        servicingBranchId: bulkServicingBranchId.trim(),
        teamId: null,
      }),
    );
    fetcher.submit(fd, { method: 'post' });
  };

  const confirmDelete = () => {
    if (!deleteProductId) return;
    const fd = new FormData();
    fd.set('json', JSON.stringify({ intent: 'deleteProductRouting', productId: deleteProductId }));
    fetcher.submit(fd, { method: 'post' });
    setDeleteProductId(null);
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
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setSelectedProductIds(
                      new Set(
                        filteredProductsForBulk
                          .filter((p) => !ruleByProductId.has(p.id))
                          .map((p) => p.id),
                      ),
                    )
                  }
                  disabled={filteredProductsForBulk.every((p) => ruleByProductId.has(p.id))}
                >
                  Select visible
                </Button>
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
                {filteredProductsForBulk.map((p) => {
                  const rule = ruleByProductId.get(p.id);
                  const assigned =
                    rule && rule.targets.length > 0
                      ? rule.targets.map(formatTargetLine).join(' · ')
                      : null;
                  // A product can only live in one CS branch at a time. The
                  // checkbox is disabled while an assignment exists so the user
                  // is forced to Remove the old route first — prevents an
                  // accidental overwrite during a bulk action that crosses an
                  // already-routed row.
                  const isAlreadyAssigned = Boolean(rule);
                  return (
                    <div
                      key={p.id}
                      className={`flex flex-wrap items-center gap-3 px-3 py-2.5 ${
                        isAlreadyAssigned ? 'bg-app-hover/30' : 'hover:bg-app-hover/40'
                      }`}
                    >
                      <Checkbox
                        checked={selectedProductIds.has(p.id)}
                        disabled={isAlreadyAssigned}
                        onChange={() => {
                          if (isAlreadyAssigned) return;
                          setSelectedProductIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(p.id)) next.delete(p.id);
                            else next.add(p.id);
                            return next;
                          });
                        }}
                        aria-label={
                          isAlreadyAssigned
                            ? `${p.name} is already assigned — remove the existing route to re-assign`
                            : `Select ${p.name}`
                        }
                        title={
                          isAlreadyAssigned
                            ? 'Already assigned — click Remove to free this product, then re-assign.'
                            : undefined
                        }
                      />
                      <span
                        className="min-w-0 flex-1 text-sm font-medium text-app-fg truncate"
                        title={p.name}
                      >
                        {p.name}
                      </span>
                      <span
                        className={`text-xs max-w-[14rem] truncate sm:max-w-xs ${
                          assigned
                            ? 'text-app-fg-muted'
                            : 'text-warning-700 dark:text-warning-400 italic'
                        }`}
                        title={
                          assigned ?? 'No CS branch assigned — pick one and click Assign selected.'
                        }
                      >
                        {assigned ?? 'Not assigned'}
                      </span>
                      {rule ? (
                        <TableActionButton
                          type="button"
                          variant="danger"
                          onClick={() => setDeleteProductId(p.id)}
                        >
                          Remove
                        </TableActionButton>
                      ) : null}
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
        open={!!deleteProductId}
        onClose={() => setDeleteProductId(null)}
        title="Remove product route?"
        description="This product will be unassigned until you assign a CS branch again."
        confirmLabel="Remove"
        variant="danger"
        onConfirm={confirmDelete}
      />

      <ConfirmActionModal
        open={assignConfirmOpen}
        onClose={() => {
          if (busy) return; // block dismiss while in flight
          setAssignConfirmOpen(false);
        }}
        title={`Assign ${selectedProductIds.size} product${selectedProductIds.size === 1 ? '' : 's'}?`}
        description={(() => {
          const branchLabel =
            branchNameById.get(bulkServicingBranchId) ?? 'the chosen servicing branch';
          const verbing = selectedProductIds.size === 1 ? 'this product' : 'these products';
          return `New orders for ${verbing} will route to Sales at ${branchLabel}. Existing routes will be replaced.`;
        })()}
        confirmLabel="Assign"
        variant="warning"
        loading={busy}
        error={fetcher.data && !fetcher.data.success ? fetcher.data.error ?? null : null}
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
