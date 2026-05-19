import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export interface UserBranchBadgeItem {
  branchId: string;
  branchName: string;
  branchCode: string;
  isPrimary?: boolean;
}

/** Primary first — keeps the most relevant branch at the start of the row (compact tables). */
function orderBranchesForDisplay(branches: UserBranchBadgeItem[]): UserBranchBadgeItem[] {
  return [...branches].sort((a, b) => {
    if (!!a.isPrimary === !!b.isPrimary) return 0;
    return a.isPrimary ? -1 : 1;
  });
}

function branchPillClassName(branch: UserBranchBadgeItem, compactSize: boolean): string {
  const tone =
    branch.isPrimary
      ? 'bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-700 text-brand-700 dark:text-brand-300'
      : 'bg-app-hover border-app-border text-app-fg-muted';
  const size = compactSize ? 'px-2 py-0.5 text-micro' : 'px-2.5 py-0.5 text-xs';
  return `inline-flex items-center gap-1 rounded-full border ${tone} ${size} font-medium whitespace-nowrap`;
}

function CompactBranchBadgeRow({
  listForPills,
  pills,
}: {
  listForPills: UserBranchBadgeItem[];
  pills: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const updatePanelPosition = useCallback(() => {
    if (typeof window === 'undefined' || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const margin = 8;
    const width = Math.min(288, window.innerWidth - margin * 2);
    let left = rect.right - width;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    const top = rect.bottom + margin;
    setPanelPos({ top, left, width });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPanelPos(null);
      return;
    }
    updatePanelPosition();
  }, [open, updatePanelPosition]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', updatePanelPosition, true);
    window.addEventListener('resize', updatePanelPosition);
    return () => {
      window.removeEventListener('scroll', updatePanelPosition, true);
      window.removeEventListener('resize', updatePanelPosition);
    };
  }, [open, updatePanelPosition]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const showDetailsTrigger = listForPills.length > 1;

  const portal =
    open && panelPos && showDetailsTrigger && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="region"
            aria-label="Branches"
            className="pointer-events-auto max-h-48 overflow-y-auto rounded-lg border border-app-border-strong bg-app-elevated py-2 pl-3 pr-2 text-left shadow-lg z-[300]"
            style={{
              position: 'fixed',
              top: panelPos.top,
              left: panelPos.left,
              width: panelPos.width,
            }}
          >
            <ul className="m-0 list-none space-y-1 pr-1 text-mini leading-snug text-app-fg">
              {listForPills.map((b) => (
                <li key={`${b.branchId}-${b.branchCode}`}>
                  <span className="font-medium">{b.branchName}</span>
                  <span className="font-mono text-app-fg-muted"> {b.branchCode}</span>
                  {b.isPrimary ? (
                    <span className="ml-1 text-micro font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">
                      Primary
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div ref={wrapRef} className="flex min-w-0 max-w-full items-center gap-1">
        <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-hidden">{pills}</div>
        {showDetailsTrigger ? (
          <button
            ref={triggerRef}
            type="button"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-app-fg-muted hover:bg-app-hover hover:text-app-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-app-canvas"
            aria-expanded={open}
            aria-controls={panelId}
            aria-haspopup="true"
            aria-label="View all branches"
            onClick={() => {
              setOpen((v) => !v);
            }}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>
        ) : null}
      </div>
      {portal}
    </>
  );
}

export function UserBranchBadges({
  branches,
  compact = false,
}: {
  branches: UserBranchBadgeItem[] | null | undefined;
  compact?: boolean;
}) {
  if (!branches || branches.length === 0) {
    return (
      <span className={compact ? 'text-mini text-app-fg-muted' : 'text-xs text-app-fg-muted'}>
        No branch
      </span>
    );
  }

  const listForPills = compact ? orderBranchesForDisplay(branches) : branches;

  const pills = listForPills.map((branch) => (
    <span
      key={`${branch.branchId}-${branch.branchCode}`}
      className={`${branchPillClassName(branch, compact)} shrink-0`}
      {...(compact ? {} : { title: `${branch.branchName} (${branch.branchCode})` })}
    >
      <span className={compact ? 'max-w-[4.5rem] truncate' : 'max-w-[110px] truncate'}>{branch.branchName}</span>
      <span className="font-mono opacity-80">{branch.branchCode}</span>
    </span>
  ));

  if (compact) {
    return <CompactBranchBadgeRow listForPills={listForPills} pills={pills} />;
  }

  return <div className="flex flex-wrap items-center gap-1.5">{pills}</div>;
}
