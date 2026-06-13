import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useEffect } from 'react';
import { useLocation, useNavigate, useSubmit } from '@remix-run/react';
import { BranchContextRequiredModal } from '~/components/ui/branch-context-required-modal';
import { isOrgWideDepartmentHead } from '~/lib/rbac';

type BranchInfo = { id: string; name: string; code: string };

interface BranchScopeGuardContextValue {
  requiresBranchSelection: boolean;
  ensureBranchForAction: (opts: {
    actionLabel?: string;
    /**
     * Optional destination to navigate to after the user picks a branch and
     * /admin/branches/switch redirects. Used by `BranchScopedLink` so a single
     * click on "+ New Form" can resolve to (1) pick branch (2) land on the
     * builder, instead of forcing a re-click.
     */
    nextHref?: string;
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
  branchesHydrationReady = true,
  children,
}: {
  role: string | undefined;
  currentBranchId: string | null | undefined;
  branches: BranchInfo[];
  /** When false (e.g. streaming `branches.list` on `/admin`), skip org-wide submit interception. */
  branchesHydrationReady?: boolean;
  children: React.ReactNode;
}) {
  const submit = useSubmit();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [actionLabel, setActionLabel] = useState<string>('this action');
  const [nextHref, setNextHref] = useState<string | null>(null);
  const consumedBranchPickerNextRef = useRef<string | null>(null);
  // Stored callback for inline-proceed (mutations). When set, the modal
  // calls this with the chosen branchId instead of switching the session.
  const pendingOnProceedRef = useRef<((branchId: string) => void) | null>(null);
  // Stored form + action for the global submit-capture path so the modal
  // can replay the submission with branchId injected.
  const pendingFormReplayRef = useRef<{ form: HTMLFormElement; action: string } | null>(null);

  // Only prompt when there's an actual choice to make — an org-wide head
  // viewing All Branches with MULTIPLE branches in their roster. If they
  // only belong to a single branch, the popup is useless (no alternative
  // to pick) and `ensureBranchForAction`'s fallback below auto-uses that
  // sole branch on every mutation.
  const needsOrgWideBranchPick =
    branchesHydrationReady &&
    isOrgWideDepartmentHead({ role: role ?? '' }) &&
    currentBranchId == null &&
    branches.length > 1;
  const requiresBranchSelection = needsOrgWideBranchPick;

  const ensureBranchForAction = useCallback<BranchScopeGuardContextValue['ensureBranchForAction']>(
    ({ actionLabel: label, nextHref: next, onProceed }) => {
      if (!requiresBranchSelection) {
        const fallbackBranch = currentBranchId ?? branches[0]?.id ?? '';
        if (fallbackBranch && onProceed) onProceed(fallbackBranch);
        return true;
      }
      setActionLabel(label ?? 'this action');
      setNextHref(next ?? null);
      pendingOnProceedRef.current = onProceed ?? null;
      pendingFormReplayRef.current = null;
      setSelectedBranchId((prev) => prev || branches[0]?.id || '');
      setOpen(true);
      return false;
    },
    [requiresBranchSelection, currentBranchId, branches],
  );

  // Server-side safety net: when a loader detected the user lacks branch
  // scope and redirected to a parent list with `?branchPickerNext=<dest>`,
  // auto-open the modal here with that destination preselected so the
  // single round-trip (pick branch -> switch -> land on dest) is preserved
  // even for deep links / bookmarks / search-modal jumps.
  useEffect(() => {
    if (!branchesHydrationReady || !requiresBranchSelection) return;
    const params = new URLSearchParams(location.search);
    const next = params.get('branchPickerNext');
    if (!next) return;
    const consumeKey = `${location.pathname}?${next}`;
    if (consumedBranchPickerNextRef.current === consumeKey) return;
    consumedBranchPickerNextRef.current = consumeKey;
    setActionLabel('this action');
    setNextHref(next);
    pendingOnProceedRef.current = null;
    pendingFormReplayRef.current = null;
    setSelectedBranchId((prev) => prev || branches[0]?.id || '');
    setOpen(true);
    // Strip the param from the URL so a subsequent close + reopen of the
    // page doesn't re-trigger the modal endlessly.
    params.delete('branchPickerNext');
    const cleaned = params.toString();
    navigate(`${location.pathname}${cleaned ? `?${cleaned}` : ''}${location.hash}`, {
      replace: true,
      preventScrollReset: true,
    });
  }, [
    branchesHydrationReady,
    requiresBranchSelection,
    location.pathname,
    location.search,
    location.hash,
    navigate,
    branches,
  ]);

  useEffect(() => {
    if (!branchesHydrationReady || !requiresBranchSelection) return;

    const onSubmitCapture = (event: Event) => {
      const submitEvent = event as SubmitEvent;
      const form = submitEvent.target instanceof HTMLFormElement ? submitEvent.target : null;
      if (!form) return;

      const method = (form.getAttribute('method') || 'get').toLowerCase();
      if (method !== 'post') return;

      const action = form.getAttribute('action') ?? '';
      if (action.includes('/admin/branches/switch')) return;
      if (action.includes('/auth/mirror/stop')) return;
      // Follow-up assignments auto-resolve the branch from the closer — no branch picker needed.
      if (action.includes('/admin/cs/follow-up') || location.pathname.includes('/admin/cs/follow-up')) return;

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
      pendingOnProceedRef.current = null;
      pendingFormReplayRef.current = { form, action };
      setSelectedBranchId((prev) => prev || branches[0]?.id || '');
      setOpen(true);
    };

    document.addEventListener('submit', onSubmitCapture, true);
    return () => document.removeEventListener('submit', onSubmitCapture, true);
  }, [branches, requiresBranchSelection, role, branchesHydrationReady]);

  const handleConfirm = useCallback(() => {
    if (!selectedBranchId) return;

    // Path 1: onProceed callback (ensureBranchForAction callers)
    if (pendingOnProceedRef.current) {
      pendingOnProceedRef.current(selectedBranchId);
      pendingOnProceedRef.current = null;
      pendingFormReplayRef.current = null;
      setOpen(false);
      setNextHref(null);
      return;
    }

    // Path 2: Captured form submit — replay with branchId injected
    if (pendingFormReplayRef.current) {
      const { form, action } = pendingFormReplayRef.current;
      const fd = new FormData(form);
      fd.set('branchId', selectedBranchId);
      submit(fd, { method: 'post', ...(action ? { action } : {}) });
      pendingFormReplayRef.current = null;
      pendingOnProceedRef.current = null;
      setOpen(false);
      setNextHref(null);
      return;
    }

    // Path 3: Navigation (nextHref from BranchScopedLink / branchPickerNext)
    // — must switch session because the destination loader needs branch context.
    const payload: Record<string, string> = {
      intent: 'switchBranch',
      branchId: selectedBranchId,
    };
    if (nextHref) payload.next = nextHref;
    submit(payload, { method: 'post', action: '/admin/branches/switch' });
    setOpen(false);
    setNextHref(null);
  }, [selectedBranchId, nextHref, submit]);

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
        isNavigation={!pendingOnProceedRef.current && !pendingFormReplayRef.current}
        onClose={() => {
          setOpen(false);
          setNextHref(null);
          pendingOnProceedRef.current = null;
          pendingFormReplayRef.current = null;
        }}
        onSelectedBranchChange={setSelectedBranchId}
        onConfirm={handleConfirm}
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
