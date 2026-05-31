import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { TextInput } from '~/components/ui/text-input';
import { AmountInput } from '~/components/ui/amount-input';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { useFetcherToast } from '~/components/ui/toast';
import { RoleBadge, formatRoleLabel } from '~/components/ui/role-badge';
import { Collapsible } from '~/components/ui/collapsible';
import { RadioGroup } from '~/components/ui/radio-group';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useOptimisticListMerge } from '~/hooks/useOptimisticListMerge';
import { isOptimisticId, optimisticId } from '~/lib/optimistic';
import type { CommissionPlan } from './types';

interface CommissionPlansPageProps {
  plans: CommissionPlan[];
  total: number;
  /** Roles this viewer is allowed to create / edit plans for (empty for non-managers). */
  manageableRoles: string[];
  viewer: { id: string; role: string };
}

type PlanStatus = 'ACTIVE' | 'UPCOMING' | 'EXPIRED';

const ROLE_FILTER_UNIVERSAL = '__UNIVERSAL__';

/** Roles whose payroll engine currently auto-credits DELIVERED + pipeline orders from CRM attribution. */
function planUsesOrderPipelineMetrics(role: string | null | undefined): boolean {
  if (role == null || role === '') return true;
  return role === 'CS_CLOSER' || role === 'MEDIA_BUYER';
}

function deriveStatus(plan: CommissionPlan): PlanStatus {
  const now = new Date();
  const from = new Date(plan.effectiveFrom);
  const to = plan.effectiveTo ? new Date(plan.effectiveTo) : null;
  if (from > now) return 'UPCOMING';
  if (to && to < now) return 'EXPIRED';
  return 'ACTIVE';
}

function formatRules(rules: Record<string, unknown>): string {
  const parts: string[] = [];
  if (rules['baseSalary']) parts.push(`Base: ₦${Number(rules['baseSalary']).toLocaleString('en-NG')}`);
  if (rules['baseThreshold']) parts.push(`Threshold: ${rules['baseThreshold']} orders`);
  if (rules['perOrderRate']) parts.push(`Per order: ₦${Number(rules['perOrderRate']).toLocaleString('en-NG')}`);
  if (rules['bonusPerExtraOrder']) parts.push(`Extra: ₦${Number(rules['bonusPerExtraOrder']).toLocaleString('en-NG')}`);
  if (rules['penaltyPerReturn']) parts.push(`Penalty: ₦${Number(rules['penaltyPerReturn']).toLocaleString('en-NG')}`);
  if (rules['deliveryRateThreshold']) parts.push(`Del. rate bonus: >${rules['deliveryRateThreshold']}%`);
  if (rules['deliveryRateBonusMultiplier'] != null && rules['deliveryRateBonusMultiplier'] !== '') {
    parts.push(`Del. accel: ×${Number(rules['deliveryRateBonusMultiplier'])}`);
  }
  const tiers = rules['orderRateTiers'];
  if (Array.isArray(tiers) && tiers.length) parts.push(`${tiers.length} tier(s)`);
  if (rules['minPerformanceBonus']) parts.push(`Min perf: ₦${Number(rules['minPerformanceBonus']).toLocaleString('en-NG')}`);
  if (rules['maxPerformanceBonus']) parts.push(`Max perf: ₦${Number(rules['maxPerformanceBonus']).toLocaleString('en-NG')}`);
  return parts.length > 0 ? parts.join(' · ') : 'No rules configured';
}

export function CommissionPlansPage({ plans, total, manageableRoles, viewer }: CommissionPlansPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const planSurface = useFetcherActionSurface(fetcher);
  const [showCreate, setShowCreate] = useState(false);
  const [viewPlan, setViewPlan] = useState<CommissionPlan | null>(null);
  const [editPlan, setEditPlan] = useState<CommissionPlan | null>(null);

  useFetcherToast(fetcher.data, {
    successMessage: 'Commission plan saved',
    skipErrorToast: showCreate || !!editPlan,
  });

  /** Filters — Role select narrows by exact role; Status narrows by computed Active/Upcoming/Expired. */
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | PlanStatus>('ALL');

  // Optimistic-add: render a synthetic plan row the instant the form submits
  // so the user sees their new plan in the list before the server responds.
  // The synthetic row gets `id: __optimistic_…`; row chrome (action buttons,
  // edit) is disabled until the canonical row replaces it on revalidation.
  const buildOptimisticPlans = useCallback<
    (fd: FormData, intent: string) => CommissionPlan[] | null
  >((fd, intent) => {
    if (intent !== 'createPlan') return null;
    const planName = fd.get('planName')?.toString().trim();
    const roleRaw = fd.get('role')?.toString().trim();
    if (!planName) return null;
    const role = roleRaw === '' ? null : roleRaw;
    const rules: Record<string, unknown> = {};
    for (const key of [
      'baseSalary',
      'baseThreshold',
      'perOrderRate',
      'bonusPerExtraOrder',
      'penaltyPerReturn',
      'deliveryRateThreshold',
    ]) {
      const v = fd.get(key)?.toString().trim();
      if (v) rules[key] = v;
    }
    const effectiveFrom = fd.get('effectiveFrom')?.toString() || new Date().toISOString().slice(0, 10);
    const effectiveTo = fd.get('effectiveTo')?.toString() || null;
    return [
      {
        id: optimisticId(),
        planName,
        role: role ?? null,
        rules,
        effectiveFrom: new Date(effectiveFrom).toISOString(),
        effectiveTo: effectiveTo ? new Date(effectiveTo).toISOString() : null,
      },
    ];
  }, []);
  const optimisticPlans = useOptimisticListMerge<CommissionPlan>(fetcher, buildOptimisticPlans);

  const filteredPlans = useMemo(() => {
    const all = [...optimisticPlans, ...plans];
    return all.filter((p) => {
      if (roleFilter === ROLE_FILTER_UNIVERSAL) {
        if (p.role != null) return false;
      } else if (roleFilter !== 'ALL' && p.role !== roleFilter) {
        return false;
      }
      if (statusFilter !== 'ALL' && deriveStatus(p) !== statusFilter) return false;
      return true;
    });
  }, [plans, optimisticPlans, roleFilter, statusFilter]);

  // Distinct roles in the loaded set — used to populate the Role filter without showing roles
  // the viewer can't see anyway.
  const hasUniversalPlans = useMemo(() => plans.some((p) => p.role == null), [plans]);
  const visibleRoles = useMemo(
    () =>
      Array.from(new Set(plans.map((p) => p.role).filter((r): r is string => r != null && r !== ''))),
    [plans],
  );

  // Success — close the matching modal. Intent filter scopes the close so
  // submitting createPlan never closes the edit modal and vice versa.
  const handleCreateSuccess = useCallback(() => setShowCreate(false), []);
  const handleEditSuccess = useCallback(() => setEditPlan(null), []);
  useCloseOnFetcherSuccess(fetcher, handleCreateSuccess, { intent: 'createPlan' });
  useCloseOnFetcherSuccess(fetcher, handleEditSuccess, { intent: 'updatePlan' });

  const canCreate = manageableRoles.length > 0;
  const canManage = useCallback(
    (planRole: string | null) => planRole == null || manageableRoles.includes(planRole),
    [manageableRoles],
  );

  const planColumns: CompactTableColumn<CommissionPlan>[] = useMemo(
    () => [
      {
        key: 'planName',
        header: 'Plan Name',
        render: (plan) => {
          const isOptimistic = isOptimisticId(plan.id);
          return (
            <Fragment>
              <span className="font-medium text-app-fg">{plan.planName}</span>
              {isOptimistic ? (
                <span className="ml-2 text-xs text-app-fg-muted italic">Saving…</span>
              ) : null}
            </Fragment>
          );
        },
      },
      {
        key: 'role',
        header: 'Role',
        render: (plan) =>
          plan.role ? (
            <RoleBadge role={plan.role} />
          ) : (
            <span className="rounded-full border border-app-border px-2 py-0.5 text-2xs font-medium text-app-fg-muted whitespace-nowrap">
              Per-user only
            </span>
          ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (plan) => {
          const status = deriveStatus(plan);
          return (
            <span
              className={
                status === 'ACTIVE'
                  ? 'badge-success'
                  : status === 'UPCOMING'
                    ? 'badge-warning'
                    : 'badge-danger'
              }
            >
              {status}
            </span>
          );
        },
      },
      {
        key: 'effective',
        header: 'Effective',
        nowrap: true,
        render: (plan) => (
          <span className="text-sm text-app-fg-muted">
            {new Date(plan.effectiveFrom).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
            {plan.effectiveTo
              ? ` — ${new Date(plan.effectiveTo).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}`
              : ' — Ongoing'}
          </span>
        ),
      },
      {
        key: 'rules',
        header: 'Rules',
        minWidth: 'min-w-[200px]',
        cellClassName: 'max-w-[280px]',
        cellTitle: (plan) => formatRules(plan.rules),
        render: (plan) => (
          <span className="text-xs text-app-fg-muted truncate block">{formatRules(plan.rules)}</span>
        ),
      },
      {
        key: 'actions',
        header: '',
        mobileLabel: 'Actions',
        align: 'right',
        tight: true,
        render: (plan) => {
          const editable = canManage(plan.role);
          const isOptimistic = isOptimisticId(plan.id);
          return (
            <div className="inline-flex gap-1.5 justify-end">
              <CompactTableActionButton disabled={isOptimistic} onClick={() => setViewPlan(plan)}>
                View
              </CompactTableActionButton>
              {editable ? (
                <CompactTableActionButton
                  tone="brand"
                  className="!text-app-fg-muted hover:!text-brand-500 dark:hover:!text-brand-400"
                  disabled={isOptimistic}
                  onClick={() => setEditPlan(plan)}
                >
                  Edit
                </CompactTableActionButton>
              ) : null}
            </div>
          );
        },
      },
    ],
    [canManage],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Commission Plans"
        mobileInlineActions
        description={
          canCreate
            ? 'Set base pay and commission rules for roles or staff.'
            : 'You do not have permission to create or edit commission plans.'
        }
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Commission plan toolbar"
            desktop={
              <>
                <PageRefreshButton />
                {canCreate ? (
                  <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
                    + New Commission Plan
                  </Button>
                ) : null}
              </>
            }
            sheet={({ closeSheet }) =>
              canCreate ? (
                <Button
                  variant="primary"
                  size="sm"
                  className="h-12 w-full justify-center"
                  onClick={() => {
                    closeSheet();
                    setShowCreate(true);
                  }}
                >
                  + New Commission Plan
                </Button>
              ) : null
            }
          />
        }
      />

      {/* Filter bar */}
      {plans.length > 0 && (
        <div className="card flex flex-col sm:flex-row gap-3">
          <SearchableSelect
            label="Role"
            value={roleFilter}
            onChange={(v) => setRoleFilter(v)}
            options={[
              { value: 'ALL', label: 'All plans' },
              ...(hasUniversalPlans
                ? [{ value: ROLE_FILTER_UNIVERSAL, label: 'Per-user templates (no role)' }]
                : []),
              ...visibleRoles.map((r) => ({ value: r, label: formatRoleLabel(r) })),
            ]}
            searchPlaceholder="Search roles..."
            wrapperClassName="sm:w-56"
          />
          <FormSelect
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | PlanStatus)}
            options={[
              { value: 'ALL', label: 'All statuses' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'UPCOMING', label: 'Upcoming' },
              { value: 'EXPIRED', label: 'Expired' },
            ]}
            className="sm:w-48"
          />
          <div className="flex-1 flex items-end justify-end">
            <span className="text-xs text-app-fg-muted">
              {filteredPlans.length === total
                ? `${total} plan${total === 1 ? '' : 's'}`
                : `${filteredPlans.length} of ${total} plans`}
            </span>
          </div>
        </div>
      )}

      {plans.length === 0 ? (
        <EmptyState
          title="No commission plans yet"
          description={
            canCreate
              ? 'Create your first plan to start paying staff according to delivered orders.'
              : 'Plans for your team will appear here once your Head of Department creates them.'
          }
        />
      ) : filteredPlans.length === 0 ? (
        <EmptyState
          title="No plans match these filters"
          description="Loosen the role or status filter to see more results."
        />
      ) : (
        <CompactTable<CommissionPlan>
          columns={planColumns}
          rows={filteredPlans}
          rowKey={(p) => p.id}
          rowClassName={(p) => (isOptimisticId(p.id) ? 'opacity-60' : '')}
          emptyTitle="No plans match these filters"
          emptyDescription="Loosen the role or status filter to see more results."
        />
      )}

      {/* Create modal — generous padding (p-6 sm:p-8) and tight inner spacing for breathing room */}
      {showCreate && canCreate && (
        <Modal
          open
          onClose={() => {
            if (fetcher.state !== 'idle') return;
            setShowCreate(false);
          }}
          maxWidth="max-w-2xl"
          backdropBlur
          contentClassName="p-6 sm:p-8 space-y-5"
        >
          <PlanFormHeader
            title="New Commission Plan"
            subtitle="Optional default role, or a universal template linked from each staff profile under Commission plan."
            onClose={() => {
              if (fetcher.state !== 'idle') return;
              setShowCreate(false);
            }}
          />
          <ModalFetcherInlineError message={planSurface.errorMatchingIntent('createPlan')} />
          <PlanForm
            key="create-plan"
            mode="create"
            manageableRoles={manageableRoles}
            submitting={fetcher.state === 'submitting' && fetcher.formData?.get('intent') === 'createPlan'}
            fetcher={fetcher}
            onCancel={() => setShowCreate(false)}
          />
        </Modal>
      )}

      {/* Edit modal — same form, prefilled */}
      {editPlan && (
        <Modal
          open
          onClose={() => {
            if (fetcher.state !== 'idle') return;
            setEditPlan(null);
          }}
          maxWidth="max-w-2xl"
          backdropBlur
          contentClassName="p-6 sm:p-8 space-y-5"
        >
          <PlanFormHeader
            title={`Edit · ${editPlan.planName}`}
            subtitle={`${
              editPlan.role
                ? `Role default: ${formatRoleLabel(editPlan.role)}`
                : 'Per-user template (no role default)'
            } · Effective from ${new Date(editPlan.effectiveFrom).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}`}
            onClose={() => {
              if (fetcher.state !== 'idle') return;
              setEditPlan(null);
            }}
          />
          <ModalFetcherInlineError message={planSurface.errorMatchingIntent('updatePlan')} />
          <PlanForm
            key={editPlan.id}
            mode="edit"
            plan={editPlan}
            manageableRoles={manageableRoles}
            submitting={fetcher.state === 'submitting' && fetcher.formData?.get('intent') === 'updatePlan'}
            fetcher={fetcher}
            onCancel={() => setEditPlan(null)}
          />
        </Modal>
      )}

      {/* View modal — read-only detail */}
      {viewPlan && (
        <Modal
          open
          onClose={() => setViewPlan(null)}
          maxWidth="max-w-lg"
          backdropBlur
          contentClassName="p-6 sm:p-8 space-y-5"
        >
          <PlanFormHeader
            title={viewPlan.planName}
            subtitle={
              viewPlan.role ? (
                <RoleBadge role={viewPlan.role} size="sm" className="mt-1" />
              ) : (
                <span className="mt-1 inline-block rounded-full border border-app-border px-2 py-0.5 text-2xs font-medium text-app-fg-muted">
                  Per-user assignment only
                </span>
              )
            }
            onClose={() => setViewPlan(null)}
          />

          <div className="space-y-2">
            {(
              [
                'baseSalary',
                'baseThreshold',
                'perOrderRate',
                'bonusPerExtraOrder',
                'penaltyPerReturn',
                'deliveryRateThreshold',
                'deliveryRateBonusMultiplier',
                'minPerformanceBonus',
                'maxPerformanceBonus',
              ] as const
            ).map((key) => {
              const value = viewPlan.rules[key];
              if (value == null) return null;
              const isCurrency =
                key === 'baseSalary' ||
                key === 'perOrderRate' ||
                key === 'bonusPerExtraOrder' ||
                key === 'penaltyPerReturn' ||
                key === 'minPerformanceBonus' ||
                key === 'maxPerformanceBonus';
              const isPercent = key === 'deliveryRateThreshold';
              const isMultiplier = key === 'deliveryRateBonusMultiplier';
              const isDeduction = key === 'penaltyPerReturn';
              const label = ({
                baseSalary: 'Base Salary',
                baseThreshold: 'Base Threshold',
                perOrderRate: 'Per Order Commission',
                bonusPerExtraOrder: 'Extra Order Bonus',
                penaltyPerReturn: 'Return Penalty',
                deliveryRateThreshold: 'Delivery Rate Threshold',
                deliveryRateBonusMultiplier: 'Delivery accel. multiplier',
                minPerformanceBonus: 'Min performance (₦)',
                maxPerformanceBonus: 'Max performance (₦)',
              } as const)[key];
              return (
                <div key={key} className="flex items-center justify-between py-2 px-3 rounded-lg bg-app-hover">
                  <span className="text-sm font-medium text-app-fg">{label}</span>
                  <span className={`text-sm font-semibold ${isDeduction ? 'text-danger-600 dark:text-danger-400' : 'text-app-fg'}`}>
                    {isCurrency ? (
                      <>
                        <span>{isDeduction ? '-' : ''}</span>
                        <NairaPrice amount={Number(value)} />
                      </>
                    ) : isPercent ? (
                      `>${Number(value)}%`
                    ) : isMultiplier ? (
                      `×${Number(value)}`
                    ) : (
                      `${Number(value)} orders`
                    )}
                  </span>
                </div>
              );
            })}
            {Array.isArray(viewPlan.rules['orderRateTiers']) && viewPlan.rules['orderRateTiers'].length ? (
              <div className="py-2 px-3 rounded-lg bg-app-hover">
                <span className="text-sm font-medium text-app-fg">Marginal tiers</span>
                <pre className="mt-2 text-xs text-app-fg-muted whitespace-pre-wrap font-mono">
                  {JSON.stringify(viewPlan.rules['orderRateTiers'], null, 2)}
                </pre>
              </div>
            ) : null}
          </div>

          <div className="flex gap-2">
            {canManage(viewPlan.role) && (
              <Button
                variant="primary"
                size="sm"
                className="flex-1"
                onClick={() => {
                  setEditPlan(viewPlan);
                  setViewPlan(null);
                }}
              >
                Edit Plan
              </Button>
            )}
            <Button variant="secondary" size="sm" className="flex-1" onClick={() => setViewPlan(null)}>
              Close
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ── Sub-components: shared modal header + form ────────────────────────────── */

function PlanFormHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h3 className="text-base font-semibold text-app-fg">{title}</h3>
        {subtitle && (
          typeof subtitle === 'string'
            ? <p className="text-xs text-app-fg-muted">{subtitle}</p>
            : subtitle
        )}
      </div>
      <button type="button" onClick={onClose} className="text-app-fg-muted hover:text-app-fg p-1 -m-1 shrink-0" aria-label="Close">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

type TierDraft = { fromOrder: string; toOrder: string; ratePerOrder: string };

function PlanForm({
  mode,
  plan,
  manageableRoles,
  submitting,
  fetcher,
  onCancel,
}: {
  mode: 'create' | 'edit';
  plan?: CommissionPlan;
  manageableRoles: string[];
  submitting: boolean;
  fetcher: ReturnType<typeof useFetcher>;
  onCancel: () => void;
}) {
  const intent = mode === 'create' ? 'createPlan' : 'updatePlan';
  const rules = (plan?.rules ?? {}) as Record<string, unknown>;
  const onlyRole = manageableRoles.length === 1 ? manageableRoles[0] : null;

  const [assignmentScope, setAssignmentScope] = useState<'dept_default' | 'universal'>('dept_default');
  const [createRoleDraft, setCreateRoleDraft] = useState('');
  const [tierRows, setTierRows] = useState<TierDraft[]>([]);

  useEffect(() => {
    const tr = plan?.rules?.['orderRateTiers'];
    if (Array.isArray(tr) && tr.length) {
      setTierRows(
        tr.map((t: { fromOrder?: number; toOrder?: number | null; ratePerOrder?: number }) => ({
          fromOrder: String(t.fromOrder ?? 1),
          toOrder: t.toOrder != null ? String(t.toOrder) : '',
          ratePerOrder: t.ratePerOrder != null ? String(t.ratePerOrder) : '',
        })),
      );
    } else {
      setTierRows([]);
    }
  }, [plan?.id, plan?.rules]);

  const serializedTiers = useMemo(() => {
    const normalized = tierRows
      .map((row) => ({
        fromOrder: Math.max(1, parseInt(row.fromOrder, 10) || 1),
        toOrder: row.toOrder.trim() === '' ? null : Math.max(1, parseInt(row.toOrder, 10) || 1),
        ratePerOrder: Math.max(0, Number(row.ratePerOrder) || 0),
      }))
      .filter((t) => t.fromOrder >= 1);
    return JSON.stringify(normalized);
  }, [tierRows]);

  const contextualRole: string | null =
    mode === 'edit'
      ? plan!.role
      : onlyRole
        ? assignmentScope === 'universal'
          ? null
          : onlyRole
        : createRoleDraft || null;

  return (
    <fetcher.Form method="post" className="space-y-4">
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="orderRateTiersJson" value={serializedTiers} />
      {plan && <input type="hidden" name="planId" value={plan.id} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextInput
          label="Plan Name"
          name="planName"
          required
          placeholder="e.g. Sales Standard Plan"
          defaultValue={plan?.planName ?? ''}
        />
        {mode === 'create' && onlyRole ? (
          <div className="space-y-2">
            <RadioGroup<'dept_default' | 'universal'>
              name="_commission_plan_assignment"
              label="Applies as"
              value={assignmentScope}
              defaultValue={assignmentScope}
              layout="vertical"
              onChange={(v) => setAssignmentScope(v)}
              options={[
                {
                  value: 'dept_default',
                  label: `Department default (${formatRoleLabel(onlyRole!)})`,
                  description: 'Every staff member in this role uses this plan unless they have their own assignment.',
                },
                {
                  value: 'universal',
                  label: 'Per-user template only',
                  description: 'Pick this plan from each staff profile (Commission plan field). Never auto-selected by role alone.',
                },
              ]}
            />
            <input type="hidden" name="role" value={assignmentScope === 'universal' ? '' : onlyRole!} />
          </div>
        ) : mode === 'create' ? (
          <>
            <input type="hidden" name="role" value={createRoleDraft} />
            <SearchableSelect
              label="Default role (optional)"
              value={createRoleDraft}
              onChange={(v) => setCreateRoleDraft(v)}
              options={[
                { value: '', label: 'None — assign plan on staff profile only' },
                ...manageableRoles.map((r) => ({ value: r, label: formatRoleLabel(r) })),
              ]}
              searchPlaceholder="Search roles..."
            />
          </>

        ) : (
          <div>
            <p className="block text-sm font-medium text-app-fg-muted mb-1">Role default</p>
            <p className="input bg-app-hover/40 cursor-not-allowed">
              {plan!.role ? formatRoleLabel(plan!.role) : 'Per-user assignment only'}
            </p>
            <p className="text-xs text-app-fg-muted mt-0.5">Create a fresh plan if you must change linkage.</p>
          </div>
        )}
      </div>

      <p className="text-xs text-app-fg-muted -mt-1">
        {planUsesOrderPipelineMetrics(contextualRole)
          ? 'Payroll credits delivered + pipeline orders tied to assigned CS reps and media buyers. Other roles typically see zero attributed orders unless you customise base pay.'
          : 'This preset is optimised for allowances or specialised roles — payroll still counts CS/MB order metrics if you manually attach this plan via the staff profile.'}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium text-app-fg-muted mb-1">Base Salary (₦)</label>
          <AmountInput name="baseSalary" placeholder="0" className="input" defaultValue={rules['baseSalary'] != null ? String(rules['baseSalary']) : ''} />
          <p className="text-xs text-app-fg-muted mt-0.5">
            Earned when delivered orders reach the threshold — leave threshold empty for a guaranteed stipend.
          </p>
        </div>
        <div>
          <TextInput
            name="baseThreshold"
            type="number"
            min={0}
            label="Base Threshold (orders)"
            placeholder="20"
            defaultValue={rules['baseThreshold'] != null ? String(rules['baseThreshold']) : ''}
          />
          <p className="text-xs text-app-fg-muted mt-0.5">Minimum delivered orders to unlock base salary</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-app-fg-muted mb-1">Per Order Rate (₦)</label>
          <AmountInput name="perOrderRate" placeholder="0" className="input" defaultValue={rules['perOrderRate'] != null ? String(rules['perOrderRate']) : ''} />
          <p className="text-xs text-app-fg-muted mt-0.5">Flat rate per delivered order (ignored when tiered rates are set)</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-app-fg-muted mb-1">Bonus Per Extra Order (₦)</label>
          <AmountInput name="bonusPerExtraOrder" placeholder="0" className="input" defaultValue={rules['bonusPerExtraOrder'] != null ? String(rules['bonusPerExtraOrder']) : ''} />
          <p className="text-xs text-app-fg-muted mt-0.5">Loaded on every order above the base threshold</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-app-fg-muted mb-1">Penalty Per Return (₦)</label>
          <AmountInput name="penaltyPerReturn" placeholder="0" className="input" defaultValue={rules['penaltyPerReturn'] != null ? String(rules['penaltyPerReturn']) : ''} />
          <p className="text-xs text-app-fg-muted mt-0.5">Deducted per returned order (also drives clawbacks)</p>
        </div>
        <div>
          <TextInput
            name="deliveryRateThreshold"
            type="number"
            min={0}
            max={100}
            step={0.1}
            label="Delivery Rate Threshold (%)"
            placeholder="80"
            defaultValue={rules['deliveryRateThreshold'] != null ? String(rules['deliveryRateThreshold']) : ''}
          />
          <p className="text-xs text-app-fg-muted mt-0.5">When delivery rate exceeds this, an extra accelerator applies to orders above the base threshold</p>
        </div>
      </div>

      <Collapsible
        trigger={
          <span className="text-sm font-medium text-app-fg">Advanced — tiered rates &amp; caps</span>
        }
        defaultOpen={Boolean(rules['orderRateTiers'] || rules['deliveryRateBonusMultiplier'] || rules['minPerformanceBonus'] || rules['maxPerformanceBonus'])}
        divided
        className="rounded-lg border border-app-border px-3 py-2"
      >
        <div className="space-y-3 pt-2">
          <p className="text-xs text-app-fg-muted">
            Tier rows apply a different ₦ rate to each marginal delivered unit that falls inside the range. Leave “To order” blank for open-ended slabs.
          </p>
          {tierRows.length === 0 ? (
            <p className="text-xs text-app-fg-muted">No tiers — flat per-order pricing applies.</p>
          ) : (
            tierRows.map((row, idx) => (
              <div key={`tier-${idx}`} className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-end">
                <div className="sm:col-span-3">
                  <TextInput
                    label="From unit"
                    type="number"
                    min={1}
                    value={row.fromOrder}
                    onChange={(e) =>
                      setTierRows((rows) =>
                        rows.map((r, i) => (i === idx ? { ...r, fromOrder: e.target.value } : r)),
                      )
                    }
                  />
                </div>
                <div className="sm:col-span-3">
                  <TextInput
                    label="To unit (optional)"
                    type="number"
                    min={1}
                    placeholder="∞"
                    value={row.toOrder}
                    onChange={(e) =>
                      setTierRows((rows) =>
                        rows.map((r, i) => (i === idx ? { ...r, toOrder: e.target.value } : r)),
                      )
                    }
                  />
                </div>
                <div className="sm:col-span-4">
                  <label className="block text-sm font-medium text-app-fg-muted mb-1">₦ / unit</label>
                  <AmountInput
                    className="input"
                    value={row.ratePerOrder}
                    onChange={(v) =>
                      setTierRows((rows) =>
                        rows.map((r, i) => (i === idx ? { ...r, ratePerOrder: v } : r)),
                      )
                    }
                  />
                </div>
                <div className="sm:col-span-2 flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={() => setTierRows((rows) => rows.filter((_, i) => i !== idx))}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))
          )}
          <Button type="button" variant="secondary" size="sm" onClick={() => setTierRows((rows) => [...rows, { fromOrder: '1', toOrder: '', ratePerOrder: '' }])}>
            + Add tier
          </Button>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-app-border mt-3">
            <div>
              <TextInput
                name="deliveryRateBonusMultiplier"
                type="number"
                min={0}
                max={10}
                step={0.05}
                label="Delivery accelerator multiplier"
                placeholder="0.5 (default)"
                defaultValue={rules['deliveryRateBonusMultiplier'] != null ? String(rules['deliveryRateBonusMultiplier']) : ''}
              />
              <p className="text-xs text-app-fg-muted mt-0.5">Multiplies the bonus component when delivery rate clears the threshold (legacy default = 0.5)</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-app-fg-muted mb-1">Min performance (₦)</label>
              <AmountInput
                name="minPerformanceBonus"
                placeholder="0"
                className="input"
                defaultValue={rules['minPerformanceBonus'] != null ? String(rules['minPerformanceBonus']) : ''}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-app-fg-muted mb-1">Max performance (₦)</label>
              <AmountInput
                name="maxPerformanceBonus"
                placeholder="0"
                className="input"
                defaultValue={rules['maxPerformanceBonus'] != null ? String(rules['maxPerformanceBonus']) : ''}
              />
            </div>
          </div>
        </div>
      </Collapsible>

      {mode === 'create' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <TextInput
              name="effectiveFrom"
              type="date"
              label="Effective From"
              required
              defaultValue={new Date().toISOString().split('T')[0]}
            />
          </div>
          <div>
            <TextInput name="effectiveTo" type="date" label="Effective To (optional)" />
          </div>
        </div>
      )}

      {mode === 'edit' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-app-fg-muted mb-1">Effective From</label>
            <p className="input bg-app-hover/40 cursor-not-allowed">
              {new Date(plan!.effectiveFrom).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
            <p className="text-xs text-app-fg-muted mt-0.5">Locked — create a new plan to change start date.</p>
          </div>
          <div>
            <TextInput
              name="effectiveTo"
              type="date"
              label="Effective To (optional)"
              defaultValue={plan!.effectiveTo ? new Date(plan!.effectiveTo).toISOString().split('T')[0] : ''}
            />
            <p className="text-xs text-app-fg-muted mt-0.5">Set to end the plan; leave blank for ongoing.</p>
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={submitting}
          loadingText={mode === 'create' ? 'Saving…' : 'Updating…'}
        >
          {mode === 'create' ? 'Create Plan' : 'Save Changes'}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={submitting} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </fetcher.Form>
  );
}
