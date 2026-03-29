export interface UserBranchBadgeItem {
  branchId: string;
  branchName: string;
  branchCode: string;
  isPrimary?: boolean;
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
      <span className={compact ? 'text-[11px] text-app-fg-muted' : 'text-xs text-app-fg-muted'}>
        No branch
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {branches.map((branch) => (
        <span
          key={`${branch.branchId}-${branch.branchCode}`}
          className={`inline-flex items-center gap-1 rounded-full border ${
            branch.isPrimary
              ? 'bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-700 text-brand-700 dark:text-brand-300'
              : 'bg-app-hover border-app-border text-app-fg-muted'
          } ${compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-xs'} font-medium`}
          title={branch.branchName}
        >
          <span className="max-w-[110px] truncate">{branch.branchName}</span>
          <span className="font-mono opacity-80">{branch.branchCode}</span>
        </span>
      ))}
    </div>
  );
}
