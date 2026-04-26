import { useState, useEffect, useRef } from 'react';
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
import type { CommissionPlan } from './types';

interface CommissionPlansPageProps {
  plans: CommissionPlan[];
  total: number;
  /** Roles this viewer is allowed to create / edit plans for (empty for non-managers). */
  manageableRoles: string[];
  viewer: { id: string; role: string };
}

export function CommissionPlansPage({ plans, total, manageableRoles, viewer }: CommissionPlansPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(fetcher.data, { successMessage: 'Commission plan saved' });

  const [showCreate, setShowCreate] = useState(false);
  const [viewPlan, setViewPlan] = useState<CommissionPlan | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const createInFlightRef = useRef(false);

  // Keep the create modal open until the server replies; close on success, surface error inline.
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
      if (result?.success) {
        setShowCreate(false);
      } else if (result?.error) {
        setCreateError(result.error);
      }
    }
  }, [fetcher.state, fetcher.formData, fetcher.data, showCreate]);

  const canCreate = manageableRoles.length > 0;

  const formatRules = (rules: Record<string, unknown>) => {
    const parts: string[] = [];
    if (rules['baseSalary']) parts.push(`Base: ₦${Number(rules['baseSalary']).toLocaleString('en-NG')}`);
    if (rules['baseThreshold']) parts.push(`Threshold: ${rules['baseThreshold']} orders`);
    if (rules['perOrderRate']) parts.push(`Per order: ₦${Number(rules['perOrderRate']).toLocaleString('en-NG')}`);
    if (rules['bonusPerExtraOrder']) parts.push(`Extra bonus: ₦${Number(rules['bonusPerExtraOrder']).toLocaleString('en-NG')}`);
    if (rules['penaltyPerReturn']) parts.push(`Return penalty: ₦${Number(rules['penaltyPerReturn']).toLocaleString('en-NG')}`);
    if (rules['deliveryRateThreshold']) parts.push(`Del. rate bonus: >${rules['deliveryRateThreshold']}%`);
    return parts.length > 0 ? parts.join(' · ') : 'No rules configured';
  };

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

      {plans.length === 0 ? (
        <EmptyState
          title="No commission plans yet"
          description={
            canCreate
              ? 'Create your first plan to start paying staff according to delivered orders.'
              : 'Plans for your team will appear here once your Head of Department creates them.'
          }
        />
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Plan Name</th>
                  <th className="table-header">Role</th>
                  <th className="table-header">Effective</th>
                  <th className="table-header">Rules</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.id} className="table-row cursor-pointer hover:bg-app-hover/50" onClick={() => setViewPlan(plan)}>
                    <td className="table-cell font-medium text-app-fg">{plan.planName}</td>
                    <td className="table-cell">
                      <span className="badge-info">{plan.role.replace(/_/g, ' ')}</span>
                    </td>
                    <td className="table-cell text-sm text-app-fg-muted">
                      {new Date(plan.effectiveFrom).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {plan.effectiveTo
                        ? ` — ${new Date(plan.effectiveTo).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}`
                        : ' — Ongoing'}
                    </td>
                    <td className="table-cell text-xs text-app-fg-muted max-w-[400px] truncate">{formatRules(plan.rules)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3 px-1 py-2">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-2 cursor-pointer active:bg-surface-50 dark:active:bg-surface-800/50"
                onClick={() => setViewPlan(plan)}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-app-fg text-sm">{plan.planName}</span>
                  <span className="badge-info text-xs">{plan.role.replace(/_/g, ' ')}</span>
                </div>
                <p className="text-xs text-app-fg-muted">{formatRules(plan.rules)}</p>
                <p className="text-xs text-app-fg-muted">
                  From {new Date(plan.effectiveFrom).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {plan.effectiveTo ? ` to ${new Date(plan.effectiveTo).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}` : ' — Ongoing'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

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
          contentClassName="p-5 space-y-4"
        >
          <h3 className="text-base font-semibold text-app-fg">New Commission Plan</h3>
          <p className="text-xs text-app-fg-muted">
            Plans define base salary, per-order rate, extra-order bonuses, and return penalties for one role.
            {manageableRoles.length === 1 && ` This plan will apply to ${manageableRoles[0]?.replace(/_/g, ' ')}.`}
          </p>
          <fetcher.Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="createPlan" />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextInput label="Plan Name" name="planName" required placeholder="e.g. CS Standard Plan" />
              {manageableRoles.length === 1 ? (
                <>
                  <input type="hidden" name="role" value={manageableRoles[0]} />
                  <div>
                    <p className="block text-sm font-medium text-app-fg-muted mb-1">Role</p>
                    <p className="input bg-app-hover/40 cursor-not-allowed">{manageableRoles[0]?.replace(/_/g, ' ')}</p>
                  </div>
                </>
              ) : (
                <FormSelect
                  label="Role"
                  name="role"
                  required
                  placeholder="Select role…"
                  options={manageableRoles.map((r) => ({ value: r, label: r.replace(/_/g, ' ') }))}
                />
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-app-fg-muted mb-1">Base Salary (₦)</label>
                <AmountInput name="baseSalary" placeholder="0" className="input" />
                <p className="text-xs text-app-fg-muted mt-0.5">Earned when delivered orders ≥ threshold</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-app-fg-muted mb-1">Base Threshold (orders)</label>
                <input name="baseThreshold" type="number" min="0" placeholder="20" className="input" />
                <p className="text-xs text-app-fg-muted mt-0.5">Min delivered to earn base salary</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-app-fg-muted mb-1">Per Order Rate (₦)</label>
                <AmountInput name="perOrderRate" placeholder="0" className="input" />
                <p className="text-xs text-app-fg-muted mt-0.5">Commission per delivered order</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-app-fg-muted mb-1">Bonus Per Extra Order (₦)</label>
                <AmountInput name="bonusPerExtraOrder" placeholder="0" className="input" />
                <p className="text-xs text-app-fg-muted mt-0.5">Extra bonus above threshold</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-app-fg-muted mb-1">Penalty Per Return (₦)</label>
                <AmountInput name="penaltyPerReturn" placeholder="0" className="input" />
                <p className="text-xs text-app-fg-muted mt-0.5">Deducted per returned order</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-app-fg-muted mb-1">Delivery Rate Threshold (%)</label>
                <input name="deliveryRateThreshold" type="number" min="0" max="100" step="0.1" placeholder="80" className="input" />
                <p className="text-xs text-app-fg-muted mt-0.5">Above this = 50% extra bonus</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-app-fg-muted mb-1">Effective From</label>
                <input
                  name="effectiveFrom"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().split('T')[0]}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-app-fg-muted mb-1">Effective To (optional)</label>
                <input name="effectiveTo" type="date" className="input" />
              </div>
            </div>

            {createError && (
              <div className="rounded-md border border-danger-200 dark:border-danger-700/50 bg-danger-50 dark:bg-danger-900/20 px-3 py-2 text-xs text-danger-700 dark:text-danger-300">
                {createError}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={fetcher.state === 'submitting' && fetcher.formData?.get('intent') === 'createPlan'}
                loadingText="Saving…"
              >
                Create Plan
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={fetcher.state === 'submitting' && fetcher.formData?.get('intent') === 'createPlan'}
                onClick={() => { setShowCreate(false); setCreateError(null); }}
              >
                Cancel
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}

      {viewPlan && (
        <Modal open onClose={() => setViewPlan(null)} maxWidth="max-w-lg" backdropBlur contentClassName="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-app-fg">{viewPlan.planName}</h3>
              <span className="badge-info text-xs mt-1 inline-block">{viewPlan.role.replace(/_/g, ' ')}</span>
            </div>
            <button type="button" onClick={() => setViewPlan(null)} className="text-app-fg-muted hover:text-app-fg p-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

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

          <Button variant="secondary" size="sm" className="w-full" onClick={() => setViewPlan(null)}>
            Close
          </Button>
        </Modal>
      )}
    </div>
  );
}
