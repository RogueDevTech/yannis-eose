import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useSubmit } from '@remix-run/react';
import { BranchContextRequiredModal } from '~/components/ui/branch-context-required-modal';

type BranchInfo = { id: string; name: string; code: string };

interface BranchScopeGuardContextValue {
  requiresBranchSelection: boolean;
  ensureBranchForAction: (opts: {
    actionLabel?: string;
    onProceed: (branchId: string) => void;
  }) => boolean;
}

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
  const [pendingProceed, setPendingProceed] = useState<((branchId: string) => void) | null>(null);

  const isAdminLevel = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const requiresBranchSelection = isAdminLevel && currentBranchId == null && branches.length > 0;

  const ensureBranchForAction = useCallback<BranchScopeGuardContextValue['ensureBranchForAction']>(
    ({ actionLabel: label, onProceed }) => {
      if (!requiresBranchSelection) {
        const fallbackBranch = currentBranchId ?? branches[0]?.id ?? '';
        if (fallbackBranch) onProceed(fallbackBranch);
        return true;
      }
      setActionLabel(label ?? 'this action');
      setSelectedBranchId((prev) => prev || branches[0]?.id || '');
      setPendingProceed(() => onProceed);
      setOpen(true);
      return false;
    },
    [requiresBranchSelection, currentBranchId, branches],
  );

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
        onUseOneOff={() => {
          if (!selectedBranchId || !pendingProceed) return;
          setOpen(false);
          pendingProceed(selectedBranchId);
        }}
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
        onProceed('');
        return true;
      },
    };
  }
  return ctx;
}
