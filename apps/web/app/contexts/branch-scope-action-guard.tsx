import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useEffect } from 'react';
import { useSubmit } from '@remix-run/react';
import { BranchContextRequiredModal } from '~/components/ui/branch-context-required-modal';
import { isOrgWideDepartmentHead } from '~/lib/rbac';

type BranchInfo = { id: string; name: string; code: string };

interface BranchScopeGuardContextValue {
  requiresBranchSelection: boolean;
  ensureBranchForAction: (opts: {
    actionLabel?: string;
    onProceed?: (branchId: string) => void;
  }) => boolean;
}

const BRANCH_SCOPED_INTENTS = new Set([
  'transition',
  'assignToCS',
  'bulkTransition',
  'bulkAssign',
  'bulkAssignToCS',
  'bulkReassign',
  'redistribute',
  'claimOrder',
  'scheduleCallback',
  'adjustOrderItems',
  'revealPhone',
  'initiateCall',
  'requestFunding',
  'createFunding',
  'verifyFunding',
  'approveFundingRequest',
  'rejectFundingRequest',
  'createAdSpend',
  'approveAdSpend',
  'rejectAdSpend',
  'updateAdSpend',
  'createCampaign',
  'updateCampaign',
  'createUser',
  'updateUser',
  'deactivateUser',
  'resetPassword',
  'processEmailChange',
]);

const BranchScopeGuardContext = createContext<BranchScopeGuardContextValue | null>(null);

export function BranchScopeGuardProvider({
  role,
  currentBranchId,
  branches,
  children,
}: {
  role: string | undefined;
  currentBranchId: string | null | undefined;
  branches: BranchInfo[];
  children: React.ReactNode;
}) {
  const submit = useSubmit();
  const [open, setOpen] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [actionLabel, setActionLabel] = useState<string>('this action');

  // Only prompt when there's an actual choice to make — an org-wide head
  // viewing All Branches with MULTIPLE branches in their roster. If they
  // only belong to a single branch, the popup is useless (no alternative
  // to pick) and `ensureBranchForAction`'s fallback below auto-uses that
  // sole branch on every mutation.
  const needsOrgWideBranchPick =
    isOrgWideDepartmentHead({ role: role ?? '' }) &&
    currentBranchId == null &&
    branches.length > 1;
  const requiresBranchSelection = needsOrgWideBranchPick;

  const ensureBranchForAction = useCallback<BranchScopeGuardContextValue['ensureBranchForAction']>(
    ({ actionLabel: label, onProceed }) => {
      if (!requiresBranchSelection) {
        const fallbackBranch = currentBranchId ?? branches[0]?.id ?? '';
        if (fallbackBranch && onProceed) onProceed(fallbackBranch);
        return true;
      }
      setActionLabel(label ?? 'this action');
      setSelectedBranchId((prev) => prev || branches[0]?.id || '');
      setOpen(true);
      return false;
    },
    [requiresBranchSelection, currentBranchId, branches],
  );

  useEffect(() => {
    if (!requiresBranchSelection) return;

    const onSubmitCapture = (event: Event) => {
      const submitEvent = event as SubmitEvent;
      const form = submitEvent.target instanceof HTMLFormElement ? submitEvent.target : null;
      if (!form) return;

      const method = (form.getAttribute('method') || 'get').toLowerCase();
      if (method !== 'post') return;

      const action = form.getAttribute('action') ?? '';
      if (action.includes('/admin/branches/switch')) return;
      if (action.includes('/auth/mirror/stop')) return;

      const formData = new FormData(form);
      const intent = (formData.get('intent') || '').toString().trim();
      // Org-wide HoM: upstream funding request to Finance — not branch-scoped on the ledger (see marketing.requestFunding + trpc guard).
      if (intent === 'requestFunding' && role === 'HEAD_OF_MARKETING') return;
      const formMarkedBranchScoped =
        form.dataset.branchScopedAction === 'true' ||
        form.getAttribute('data-branch-scoped-action') === 'true';
      if (!formMarkedBranchScoped && !BRANCH_SCOPED_INTENTS.has(intent)) return;

      submitEvent.preventDefault();
      setActionLabel('this action');
      setSelectedBranchId((prev) => prev || branches[0]?.id || '');
      setOpen(true);
    };

    document.addEventListener('submit', onSubmitCapture, true);
    return () => document.removeEventListener('submit', onSubmitCapture, true);
  }, [branches, requiresBranchSelection, role]);

  const value = useMemo<BranchScopeGuardContextValue>(
    () => ({ requiresBranchSelection, ensureBranchForAction }),
    [requiresBranchSelection, ensureBranchForAction],
  );

  return (
    <BranchScopeGuardContext.Provider value={value}>
      {children}
      <BranchContextRequiredModal
        open={open}
        branches={branches}
        selectedBranchId={selectedBranchId}
        actionLabel={actionLabel}
        onClose={() => setOpen(false)}
        onSelectedBranchChange={setSelectedBranchId}
        onSwitchBranch={() => {
          if (!selectedBranchId) return;
          submit(
            { intent: 'switchBranch', branchId: selectedBranchId },
            { method: 'post', action: '/admin/branches/switch' },
          );
          setOpen(false);
        }}
      />
    </BranchScopeGuardContext.Provider>
  );
}

export function useBranchScopeActionGuard(): BranchScopeGuardContextValue {
  const ctx = useContext(BranchScopeGuardContext);
  if (!ctx) {
    return {
      requiresBranchSelection: false,
      ensureBranchForAction: ({ onProceed }) => {
        onProceed?.('');
        return true;
      },
    };
  }
  return ctx;
}
