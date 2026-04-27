import { useState, useEffect, useRef, useMemo } from 'react';
import { useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { PageHeader } from '~/components/ui/page-header';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';
import { AmountInput } from '~/components/ui/amount-input';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { useFetcherToast } from '~/components/ui/toast';
import { RoleBadge } from '~/components/ui/role-badge';
import type { CommissionPlan } from './types';

interface CommissionPlansPageProps {
  plans: CommissionPlan[];
  total: number;
  /** Roles this viewer is allowed to create / edit plans for (empty for non-managers). */
  manageableRoles: string[];
  viewer: { id: string; role: string };
}

type PlanStatus = 'ACTIVE' | 'UPCOMING' | 'EXPIRED';

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
  return parts.length > 0 ? parts.join(' · ') : 'No rules configured';
}

export function CommissionPlansPage({ plans, total, manageableRoles, viewer }: CommissionPlansPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(fetcher.data, { successMessage: 'Commission plan saved' });

  const [showCreate, setShowCreate] = useState(false);
  const [viewPlan, setViewPlan] = useState<CommissionPlan | null>(null);
  const [editPlan, setEditPlan] = useState<CommissionPlan | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const createInFlightRef = useRef(false);
  const editInFlightRef = useRef(false);

  /** Filters — Role select narrows by exact role; Status narrows by computed Active/Upcoming/Expired. */
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | PlanStatus>('ALL');

  const filteredPlans = useMemo(() => {
    return plans.filter((p) => {
      if (roleFilter !== 'ALL' && p.role !== roleFilter) return false;
      if (statusFilter !== 'ALL' && deriveStatus(p) !== statusFilter) return false;
      return true;
    });
  }, [plans, roleFilter, statusFilter]);

  // Distinct roles in the loaded set — used to populate the Role filter without showing roles
  // the viewer can't see anyway.
  const visibleRoles = useMemo(() => Array.from(new Set(plans.map((p) => p.role))), [plans]);

  // Close-on-success effects (separate refs so create + edit don't interfere)
  useEffect(() => {
    if (!showCreate) return;
    const submitting = fetcher.state === 'submitting' && fetcher.formData?.get('intent') === 'createPlan';
    if (submitting) {
      createInFlightRef.current = true;
      setCreateError(null);
      return;
    }
    if (fetcher.state === 'idle' && createInFlightRef.current) {
      createInFlightRef.current = false;
      const result = fetcher.data;
      if (result?.success) setShowCreate(false);
      else if (result?.error) setCreateError(result.error);
    }
  }, [fetcher.state, fetcher.formData, fetcher.data, showCreate]);

  useEffect(() => {
    if (!editPlan) return;
    const submitting = fetcher.state === 'submitting' && fetcher.formData?.get('intent') === 'updatePlan';
    if (submitting) {
      editInFlightRef.current = true;
      setEditError(null);
      return;
    }
    if (fetcher.state === 'idle' && editInFlightRef.current) {
      editInFlightRef.current = false;
      const result = fetcher.data;
      if (result?.success) setEditPlan(null);
      else if (result?.error) setEditError(result.error);
    }
  }, [fetcher.state, fetcher.formData, fetcher.data, editPlan]);

  const canCreate = manageableRoles.length > 0;
  const canManage = (planRole: string) => manageableRoles.includes(planRole);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Commission Plans"
        description={
          canCreate
            ? `Define how your team earns. ${manageableRoles.length === 1 ? `Limited to ${manageableRoles[0]?.replace(/_/g, ' ')}.` : 'Each plan covers one role.'}`
            : 'You do not have permission to create or edit commission plans.'
        }
        actions={
          canCreate ? (
            <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
              + New Commission Plan
            </Button>
          ) : null
        }
      />

      {/* Filter bar */}
      {plans.length > 0 && (
        <div className="card flex flex-col sm:flex-row gap-3">
          <FormSelect
            label="Role"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            options={[
              { value: 'ALL', label: 'All roles' },
              ...visibleRoles.map((r) => ({ value: r, label: r.replace(/_/g, ' ') })),
            ]}
            className="sm:w-56"
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
        <div className="card p-0">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Plan Name</th>
                  <th className="table-header">Role</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Effective</th>
                  <th className="table-header">Rules</th>
                  <th className="table-header text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPlans.map((plan) => {
                  const status = deriveStatus(plan);
                  const editable = canManage(plan.role);
                  return (
                    <tr key={plan.id} className="table-row">
                      <td className="table-cell font-medium text-app-fg">{plan.planName}</td>
                      <td className="table-cell">
                        <RoleBadge role={plan.role} />
                      </td>
                      <td className="table-cell">
                        <span className={
                          status === 'ACTIVE' ? 'badge-success' :
                          status === 'UPCOMING' ? 'badge-warning' : 'badge-danger'
                        }>{status}</span>
                      </td>
                      <td className="table-cell text-sm text-app-fg-muted whitespace-nowrap">
                        {new Date(plan.effectiveFrom).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {plan.effectiveTo
                          ? ` — ${new Date(plan.effectiveTo).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}`
                          : ' — Ongoing'}
                      </td>
                      <td className="table-cell text-xs text-app-fg-muted max-w-[280px] truncate">{formatRules(plan.rules)}</td>
                      <td className="table-cell text-right whitespace-nowrap">
                        <div className="inline-flex gap-1.5">
                          <Button variant="primary" size="sm" className="text-xs" onClick={() => setViewPlan(plan)}>
                            View
                          </Button>
                          {editable && (
                            <Button variant="secondary" size="sm" className="text-xs" onClick={() => setEditPlan(plan)}>
                              Edit
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3 px-1 py-2">
            {filteredPlans.map((plan) => {
              const status = deriveStatus(plan);
              const editable = canManage(plan.role);
              return (
                <div key={plan.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-app-fg text-sm">{plan.planName}</span>
                    <RoleBadge role={plan.role} size="sm" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className={
                      status === 'ACTIVE' ? 'badge-success text-xs' :
                      status === 'UPCOMING' ? 'badge-warning text-xs' : 'badge-danger text-xs'
                    }>{status}</span>
                    <p className="text-xs text-app-fg-muted">
                      From {new Date(plan.effectiveFrom).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                      {plan.effectiveTo ? ` to ${new Date(plan.effectiveTo).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}` : ''}
                    </p>
                  </div>
                  <p className="text-xs text-app-fg-muted">{formatRules(plan.rules)}</p>
                  <div className="flex gap-2">
                    <Button variant="primary" size="sm" className="text-xs flex-1" onClick={() => setViewPlan(plan)}>
                      View
                    </Button>
                    {editable && (
                      <Button variant="secondary" size="sm" className="text-xs flex-1" onClick={() => setEditPlan(plan)}>
                        Edit
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Create modal — generous padding (p-6 sm:p-8) and tight inner spacing for breathing room */}
      {showCreate && canCreate && (
        <Modal
          open
          onClose={() => {
            if (createInFlightRef.current || fetcher.state !== 'idle') return;
            setShowCreate(false);
            setCreateError(null);
          }}
          maxWidth="max-w-2xl"
          backdropBlur
          contentClassName="p-6 sm:p-8 space-y-5"
        >
          <PlanFormHeader
            title="New Commission Plan"
            subtitle={
              manageableRoles.length === 1
                ? `Will apply to ${manageableRoles[0]?.replace(/_/g, ' ')}.`
                : 'Plans define base salary, per-order rate, extra-order bonuses, and return penalties for one role.'
            }
            onClose={() => {
              if (createInFlightRef.current || fetcher.state !== 'idle') return;
              setShowCreate(false);
              setCreateError(null);
            }}
          />
          <PlanForm
            mode="create"
            manageableRoles={manageableRoles}
            error={createError}
            submitting={fetcher.state === 'submitting' && fetcher.formData?.get('intent') === 'createPlan'}
            fetcher={fetcher}
            onCancel={() => { setShowCreate(false); setCreateError(null); }}
          />
        </Modal>
      )}

      {/* Edit modal — same form, prefilled */}
      {editPlan && (
        <Modal
          open
          onClose={() => {
            if (editInFlightRef.current || fetcher.state !== 'idle') return;
            setEditPlan(null);
            setEditError(null);
          }}
          maxWidth="max-w-2xl"
          backdropBlur
          contentClassName="p-6 sm:p-8 space-y-5"
        >
          <PlanFormHeader
            title={`Edit · ${editPlan.planName}`}
            subtitle={`Role: ${editPlan.role.replace(/_/g, ' ')} · Effective from ${new Date(editPlan.effectiveFrom).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}`}
            onClose={() => {
              if (editInFlightRef.current || fetcher.state !== 'idle') return;
              setEditPlan(null);
              setEditError(null);
            }}
          />
          <PlanForm
            mode="edit"
            plan={editPlan}
            manageableRoles={manageableRoles}
            error={editError}
            submitting={fetcher.state === 'submitting' && fetcher.formData?.get('intent') === 'updatePlan'}
            fetcher={fetcher}
            onCancel={() => { setEditPlan(null); setEditError(null); }}
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
              <RoleBadge role={viewPlan.role} size="sm" className="mt-1" />
            }
            onClose={() => setViewPlan(null)}
          />

          <div className="space-y-2">
            {(['baseSalary','baseThreshold','perOrderRate','bonusPerExtraOrder','penaltyPerReturn','deliveryRateThreshold'] as const).map((key) => {
              const value = viewPlan.rules[key];
              if (value == null) return null;
              const isCurrency = key === 'baseSalary' || key === 'perOrderRate' || key === 'bonusPerExtraOrder' || key === 'penaltyPerReturn';
              const isPercent = key === 'deliveryRateThreshold';
              const isDeduction = key === 'penaltyPerReturn';
              const label = ({
                baseSalary: 'Base Salary',
                baseThreshold: 'Base Threshold',
                perOrderRate: 'Per Order Commission',
                bonusPerExtraOrder: 'Extra Order Bonus',
                penaltyPerReturn: 'Return Penalty',
                deliveryRateThreshold: 'Delivery Rate Threshold',
              } as const)[key];
              return (
                <div key={key} className="flex items-center justify-between py-2 px-3 rounded-lg bg-app-hover">
                  <span className="text-sm font-medium text-app-fg">{label}</span>
                  <span className={`text-sm font-semibold ${isDeduction ? 'text-danger-600 dark:text-danger-400' : 'text-app-fg'}`}>
                    {isCurrency ? <><span>{isDeduction ? '-' : ''}</span><NairaPrice amount={Number(value)} /></> : isPercent ? `>${Number(value)}%` : `${Number(value)} orders`}
                  </span>
                </div>
              );
            })}
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

function PlanForm({
  mode,
  plan,
  manageableRoles,
  error,
  submitting,
  fetcher,
  onCancel,
}: {
  mode: 'create' | 'edit';
  plan?: CommissionPlan;
  manageableRoles: string[];
  error: string | null;
  submitting: boolean;
  fetcher: ReturnType<typeof useFetcher>;
  onCancel: () => void;
}) {
  const intent = mode === 'create' ? 'createPlan' : 'updatePlan';
  const rules = (plan?.rules ?? {}) as Record<string, unknown>;

  return (
    <fetcher.Form method="post" className="space-y-4">
      <input type="hidden" name="intent" value={intent} />
      {plan && <input type="hidden" name="planId" value={plan.id} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextInput
          label="Plan Name"
          name="planName"
          required
          placeholder="e.g. CS Standard Plan"
          defaultValue={plan?.planName ?? ''}
        />
        {mode === 'create' && manageableRoles.length === 1 ? (
          <>
            <input type="hidden" name="role" value={manageableRoles[0]} />
            <div>
              <p className="block text-sm font-medium text-app-fg-muted mb-1">Role</p>
              <p className="input bg-app-hover/40 cursor-not-allowed">{manageableRoles[0]?.replace(/_/g, ' ')}</p>
            </div>
          </>
        ) : mode === 'create' ? (
          <FormSelect
            label="Role"
            name="role"
            required
            placeholder="Select role…"
            options={manageableRoles.map((r) => ({ value: r, label: r.replace(/_/g, ' ') }))}
          />
        ) : (
          // Edit: role is locked (changing role would re-attribute every payout — not supported here)
          <div>
            <p className="block text-sm font-medium text-app-fg-muted mb-1">Role</p>
            <p className="input bg-app-hover/40 cursor-not-allowed">{plan!.role.replace(/_/g, ' ')}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium text-app-fg-muted mb-1">Base Salary (₦)</label>
          <AmountInput name="baseSalary" placeholder="0" className="input" defaultValue={rules['baseSalary'] != null ? String(rules['baseSalary']) : ''} />
          <p className="text-xs text-app-fg-muted mt-0.5">Earned when delivered orders ≥ threshold</p>
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
          <p className="text-xs text-app-fg-muted mt-0.5">Min delivered to earn base salary</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-app-fg-muted mb-1">Per Order Rate (₦)</label>
          <AmountInput name="perOrderRate" placeholder="0" className="input" defaultValue={rules['perOrderRate'] != null ? String(rules['perOrderRate']) : ''} />
          <p className="text-xs text-app-fg-muted mt-0.5">Commission per delivered order</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-app-fg-muted mb-1">Bonus Per Extra Order (₦)</label>
          <AmountInput name="bonusPerExtraOrder" placeholder="0" className="input" defaultValue={rules['bonusPerExtraOrder'] != null ? String(rules['bonusPerExtraOrder']) : ''} />
          <p className="text-xs text-app-fg-muted mt-0.5">Extra bonus above threshold</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-app-fg-muted mb-1">Penalty Per Return (₦)</label>
          <AmountInput name="penaltyPerReturn" placeholder="0" className="input" defaultValue={rules['penaltyPerReturn'] != null ? String(rules['penaltyPerReturn']) : ''} />
          <p className="text-xs text-app-fg-muted mt-0.5">Deducted per returned order</p>
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
          <p className="text-xs text-app-fg-muted mt-0.5">Above this = 50% extra bonus</p>
        </div>
      </div>

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

      {error && (
        <div className="rounded-md border border-danger-200 dark:border-danger-700/50 bg-danger-50 dark:bg-danger-900/20 px-3 py-2 text-xs text-danger-700 dark:text-danger-300">
          {error}
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
