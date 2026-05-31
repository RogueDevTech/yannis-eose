import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams, useFetcher, useNavigate } from '@remix-run/react';
import { BranchScopedLink } from '~/components/ui/branch-scoped-link';
import { ActionDropdown } from '~/components/ui/action-dropdown';
import { CompactTable, CompactTableActionButton, type CompactTableColumn } from '~/components/ui/compact-table';
import { CompactUserAvatar } from '~/components/ui/compact-user-avatar';
import { OverviewStatStrip, OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { FilterDismiss } from '~/components/ui/filter-dismiss';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { SearchInput } from '~/components/ui/search-input';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { useBranchesCatalog } from '~/contexts/branches-catalog-context';
import { StatusBadge } from '~/components/ui/status-badge';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { useFetcherToast } from '~/components/ui/toast';
import { Modal } from '~/components/ui/modal';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { LocalExportModal } from '~/components/ui/local-export-modal';
import type { User } from './types';
import { ROLE_OPTIONS, formatRole } from './types';
import { RoleBadge } from '~/components/ui/role-badge';
import { ProbationBadge } from '~/components/ui/probation-badge';
import { SupervisorBadge } from '~/components/ui/supervisor-badge';
import { UserBranchBadges } from '~/components/ui/user-branch-badges';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { TableActionButton } from '~/components/ui/table-action-button';
// Legacy modal removed (CEO directive 2026-05-11) — Import now opens its own
// page at `/hr/users/import` so HR can edit rows inline before submitting.
import { hrUsersShellColumns } from '~/features/hr/HRDeferredLoadingShells';
import { shellPulsePlaceholderRows } from '~/components/ui/deferred-skeletons';

/** Matches `users.rosterSummary` — full-roster KPIs for the current URL filters. */
export type UsersRosterSummary = {
  active: number;
  pending: number;
  inactiveArchived: number;
  distinctRoles: number;
};

type UsersRosterPayload = {
  users: User[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /** Present from HR loader (`users.rosterSummary`); absent on older cached payloads. */
  summary?: UsersRosterSummary;
};

const EMPTY_ROSTER_SUMMARY: UsersRosterSummary = {
  active: 0,
  pending: 0,
  inactiveArchived: 0,
  distinctRoles: 0,
};

interface UsersListPageProps {
  /**
   * Resolved roster OR a Promise that resolves it. When a Promise, the page
   * chrome (header, filter pills, search bar, action button, pagination
   * shell) renders instantly and the table body shows skeleton rows until
   * this promise resolves (App Shell pattern).
   */
  usersPromise: Promise<UsersRosterPayload> | UsersRosterPayload;
  statusParam?: string;
  roleParam?: string;
  /** Trimmed search string applied server-side (`users.list`), mirrored from the URL. */
  searchParam?: string;
  /**
   * Branch filter value from the URL. UUID for a specific branch, the literal
   * `__ORG_WIDE__` for staff with no branch memberships (Heads / HR / Finance /
   * Admin), or `ALL` (default).
   */
  branchParam?: string;
  /** Admin-class only — gates whether the branch picker renders at all. */
  canPickBranch?: boolean;
  usersBasePath?: string;
  /** Finance roster: name + payment contact only — no HR stats, role grid, or invite actions. */
  variant?: 'default' | 'staffAccounts';
  /**
   * Staff-accounts variant only: shows the Export button. Server still enforces
   * `hr.export` — this is just the UI gate. Default false.
   */
  canExport?: boolean;
  /** Per-page picker — caller supplies the clamped current size + the choices. */
  pageSize?: number;
  pageSizeOptions?: number[];
}

/** Type guard — distinguishes a pre-resolved payload (clientLoader cache hit)
 *  from a Promise (first paint). */
function isResolvedUsersPayload<T>(v: T | Promise<T>): v is T {
  return typeof v === 'object' && v != null && !('then' in (v as object));
}

const SKELETON_ROW_COUNT = 8;

export function UsersListPage({
  usersPromise,
  statusParam = 'ALL',
  roleParam = 'ALL',
  searchParam = '',
  branchParam: _branchParamFromShell = 'ALL',
  canPickBranch = false,
  usersBasePath = '/hr/users',
  variant = 'default',
  canExport = false,
  pageSize,
  pageSizeOptions,
}: UsersListPageProps) {
  // Bridge the deferred roster to local state. Page chrome below renders
  // immediately with `null` data + skeleton rows; once the promise resolves
  // the table fills in.
  const [roster, setRoster] = useState<UsersRosterPayload | null>(
    isResolvedUsersPayload(usersPromise) ? usersPromise : null,
  );
  useEffect(() => {
    if (isResolvedUsersPayload(usersPromise)) {
      setRoster(usersPromise);
      return;
    }
    let cancelled = false;
    Promise.resolve(usersPromise)
      .then((p) => {
        if (!cancelled) setRoster(p);
      })
      .catch(() => {
        if (!cancelled)
          setRoster({
            users: [],
            total: 0,
            page: 1,
            limit: 20,
            totalPages: 0,
            summary: EMPTY_ROSTER_SUMMARY,
          });
      });
    return () => {
      cancelled = true;
    };
  }, [usersPromise]);
  const rosterLoading = roster === null;
  const users: User[] = roster?.users ?? [];
  const total: number = roster?.total ?? 0;
  /** Server aggregates (`users.rosterSummary`); page-slice fallback for older cached payloads without `summary`. */
  const rosterSummary: UsersRosterSummary =
    roster?.summary ?? {
      active: users.filter((u) => u.status === 'ACTIVE').length,
      pending: users.filter((u) => u.status === 'PENDING').length,
      inactiveArchived: users.filter((u) => u.status === 'INACTIVE' || u.status === 'ARCHIVED').length,
      distinctRoles: new Set(users.map((u) => u.role)).size,
    };
  const page: number = roster?.page ?? 1;
  const totalPages: number = roster?.totalPages ?? 0;
  const staffAccounts = variant === 'staffAccounts';
  const [searchParams, setSearchParams] = useSearchParams();
  const currentStatusParam = searchParams.has('status') ? (searchParams.get('status') || 'ALL') : 'ALL';
  const currentRoleParam = searchParams.has('role') ? (searchParams.get('role') || 'ALL') : 'ALL';
  const searchFromUrl = searchParams.get('search') ?? '';
  const [draftSearch, setDraftSearch] = useState(searchFromUrl);
  const isFilterLoading = useLoaderRefetchBusy().busy;
  const safeTotalPages = Math.max(1, totalPages);
  const resendFetcher = useFetcher<{ success?: boolean; error?: string; intent?: string }>();
  useFetcherToast(resendFetcher.data, { successMessage: 'Invite re-sent with new credentials' });
  // Confirmation modal — Resend invite mutates the user's password (a fresh temp password is
  // generated and emailed) which invalidates any older invite link. Easy to fire by accident
  // from a long table, so confirm before sending.
  const [resendConfirm, setResendConfirm] = useState<{ id: string; name: string; email: string } | null>(null);
  const [previewUser, setPreviewUser] = useState<User | null>(null);
  const isResending = resendFetcher.state !== 'idle';
  /** Single open-menu id for the page-header split-button (Add user ▾). */
  const [openHeaderMenuId, setOpenHeaderMenuId] = useState<string | null>(null);
  /** Staff-accounts export modal (client-side CSV/PDF/XLSX of the current page). */
  const [showExportModal, setShowExportModal] = useState(false);
  const navigate = useNavigate();
  /** Navigate straight to the create form — the form itself gates branch
   *  selection dynamically based on the chosen role (`data-branch-scoped-action`
   *  flips to "true" only for branch-eligible roles), so we don't block
   *  navigation upfront. Org-wide roles like Finance Officer skip branch
   *  selection entirely. */
  const goToAddUser = useCallback(() => {
    navigate(`${usersBasePath}/new`);
  }, [navigate, usersBasePath]);

  useEffect(() => {
    setDraftSearch(searchFromUrl);
  }, [searchFromUrl]);

  const submitSearchToUrl = useCallback(
    (raw: string) => {
      const trimmed = raw.trim().slice(0, 120);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (trimmed) next.set('search', trimmed);
          else next.delete('search');
          next.set('page', '1');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const hasAppliedSearch = searchFromUrl.trim().length > 0;
  const handleSearchDraftChange = useCallback(
    (value: string) => {
      setDraftSearch(value);
      if (value === '' && hasAppliedSearch) {
        submitSearchToUrl('');
      }
    },
    [hasAppliedSearch, submitSearchToUrl],
  );
  const searchRow = (
    <form
      className="min-w-0 flex-1"
      onSubmit={(event) => {
        event.preventDefault();
        submitSearchToUrl(draftSearch);
      }}
    >
      <SearchInput
        value={draftSearch}
        onChange={handleSearchDraftChange}
        placeholder="Search by name, email, or phone…"
        withSubmitButton
        wrapperClassName="min-w-0 w-full flex-1 md:min-w-0"
      />
    </form>
  );

  const handleStatusChange = (value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === 'ALL') next.delete('status');
        else next.set('status', value);
        next.set('page', '1');
        return next;
      },
      { replace: true },
    );
  };

  /** Mirrors `handleStatusChange` but returns a `?query` string for `<Link to>`. */
  const buildStatusQuery = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === 'ALL') next.delete('status');
    else next.set('status', value);
    next.set('page', '1');
    const qs = next.toString();
    return qs ? `?${qs}` : '?';
  };

  const handleRoleChange = (value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === 'ALL') next.delete('role');
        else next.set('role', value);
        next.set('page', '1');
        return next;
      },
      { replace: true },
    );
  };

  /**
   * Branch picker (admin-class only). Sentinel `__ORG_WIDE__` filters to staff
   * with no branch memberships (Heads / HR / Finance / Admin) — without it
   * those rows would silently disappear once any specific branch is chosen.
   */
  const branchesCatalog = useBranchesCatalog();
  const currentBranchParam = searchParams.has('branchId')
    ? searchParams.get('branchId') || 'ALL'
    : 'ALL';
  const branchPickerVisible = canPickBranch && branchesCatalog.length > 0;
  const branchPickerOptions = useMemo(
    () => [
      { value: 'ALL', label: 'All branches' },
      ...branchesCatalog.map((b) => ({ value: b.id, label: b.name })),
      { value: '__ORG_WIDE__', label: 'Org-wide (heads / finance / admin)' },
    ],
    [branchesCatalog],
  );
  const handleBranchChange = (value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === 'ALL') next.delete('branchId');
        else next.set('branchId', value);
        next.set('page', '1');
        return next;
      },
      { replace: true },
    );
  };

  const goToPage = (nextPage: number) => {
    const clamped = Math.min(Math.max(1, nextPage), safeTotalPages);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('page', String(clamped));
        return next;
      },
      { replace: true },
    );
  };

  const filtersToolbarBadge = useMemo(() => {
    let n = 0;
    if (currentStatusParam !== 'ALL') n += 1;
    if (currentRoleParam !== 'ALL') n += 1;
    if ((searchParams.get('search') ?? '').trim().length > 0) n += 1;
    if (searchParams.get('probationOnly') === '1') n += 1;
    if (searchParams.get('supervisorOnly') === '1') n += 1;
    if (currentBranchParam !== 'ALL') n += 1;
    return n;
  }, [currentStatusParam, currentRoleParam, searchParams, currentBranchParam]);

  const probationOnly = searchParams.get('probationOnly') === '1';
  const handleProbationOnlyToggle = (next: boolean) => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set('probationOnly', '1');
    else params.delete('probationOnly');
    params.set('page', '1');
    setSearchParams(params, { replace: true });
  };

  const supervisorOnly = searchParams.get('supervisorOnly') === '1';
  const handleSupervisorOnlyToggle = (next: boolean) => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set('supervisorOnly', '1');
    else params.delete('supervisorOnly');
    params.set('page', '1');
    setSearchParams(params, { replace: true });
  };

  // Status, role, search, probation-only, and supervisor-only are applied server-side (`users.list`).

  const staffAccountsColumns: CompactTableColumn<User>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        render: (user) => (
          <div className="flex items-center gap-2.5 min-w-0">
            <CompactUserAvatar name={user.name} />
            <span className="font-medium text-app-fg truncate">{user.name}</span>
          </div>
        ),
      },
      {
        key: 'accountName',
        header: 'Account name',
        minWidth: 'min-w-[8rem]',
        render: (user) => (
          <span className="text-sm text-app-fg-muted">{user.payoutAccountName?.trim() ? user.payoutAccountName : '—'}</span>
        ),
      },
      {
        key: 'accountNumber',
        header: 'Account number',
        nowrap: true,
        render: (user) => (
          <span className="font-mono text-sm text-app-fg tabular-nums">
            {user.payoutAccountNumber?.trim() ? user.payoutAccountNumber : '—'}
          </span>
        ),
      },
      {
        key: 'bankName',
        header: 'Bank',
        minWidth: 'min-w-[8rem]',
        render: (user) => (
          <span className="text-sm text-app-fg-muted" title={user.payoutBankName ?? undefined}>
            {user.payoutBankName?.trim() ? user.payoutBankName : '—'}
          </span>
        ),
      },
      {
        key: 'bankCode',
        header: 'Bank code',
        minWidth: 'min-w-[6rem]',
        render: (user) => (
          <span className="font-mono text-sm text-app-fg-muted tabular-nums">
            {user.payoutBankCode?.trim() ? user.payoutBankCode : '—'}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        mobileLabel: 'Actions',
        align: 'right',
        tight: true,
        render: (user) => (
          <TableActionButton to={`${usersBasePath}/${user.id}`} variant="primary">
            View
          </TableActionButton>
        ),
      },
    ],
    [usersBasePath],
  );

  // Staff-accounts export — current page only, payout/bank fields included.
  // Server still enforces `hr.export`; this just builds the client-side file.
  const staffExportColumns = useMemo(
    () => [
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'role', label: 'Role' },
      { key: 'status', label: 'Status' },
      { key: 'accountName', label: 'Account name' },
      { key: 'accountNumber', label: 'Account number' },
      { key: 'bankName', label: 'Bank' },
      { key: 'bankCode', label: 'Bank code' },
    ],
    [],
  );
  const staffExportRows = useMemo(
    () =>
      users.map((user) => ({
        name: user.name,
        email: user.email,
        role: formatRole(user.role),
        status: user.status,
        accountName: user.payoutAccountName?.trim() || '',
        accountNumber: user.payoutAccountNumber?.trim() || '',
        bankName: user.payoutBankName?.trim() || '',
        bankCode: user.payoutBankCode?.trim() || '',
      })),
    [users],
  );

  const hrUserColumns: CompactTableColumn<User>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        render: (user) => (
          <div className="flex items-center gap-2.5">
            <CompactUserAvatar name={user.name} />
            <span className="font-medium text-app-fg">{user.name}</span>
          </div>
        ),
      },
      {
        key: 'email',
        header: 'Email',
        render: (user) => <span className="text-app-fg-muted">{user.email}</span>,
      },
      {
        key: 'role',
        header: 'Role',
        render: (user) => (
          <span className="inline-flex items-center gap-1.5 flex-wrap">
            <RoleBadge variant="text" role={user.role} label={formatRole(user.role)} />
            {user.isTeamSupervisor && <SupervisorBadge size="sm" />}
            {user.isProbation && <ProbationBadge until={user.probationUntil ?? null} size="sm" showDaysRemaining={false} />}
          </span>
        ),
      },
      {
        key: 'branches',
        header: 'Branches',
        nowrap: true,
        cellClassName: 'max-w-[16rem] min-w-0 overflow-hidden',
        render: (user) => <UserBranchBadges branches={user.branchMemberships} compact />,
      },
      {
        key: 'status',
        header: 'Status',
        render: (user) => <StatusBadge status={user.status} />,
      },
      {
        key: 'joined',
        header: 'Joined',
        nowrap: true,
        render: (user) => (
          <span className="text-app-fg-muted">
            {new Date(user.createdAt).toLocaleDateString('en-NG', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        mobileLabel: 'Actions',
        align: 'right',
        tight: true,
        render: (user) => (
          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
            {user.status === 'PENDING' ? (
              <CompactTableActionButton
                className="!text-app-fg-muted hover:!text-brand-500 dark:hover:!text-brand-400"
                disabled={isResending}
                onClick={() => setResendConfirm({ id: user.id, name: user.name, email: user.email })}
              >
                Resend Invite
              </CompactTableActionButton>
            ) : null}
            <CompactTableActionButton to={`${usersBasePath}/${user.id}`}>View</CompactTableActionButton>
          </div>
        ),
      },
    ],
    [usersBasePath, isResending],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={staffAccounts ? 'Staff Accounts' : 'Users'}
        mobileInlineActions
        description={
          staffAccounts
            ? 'Review staff payout details.'
            : 'Manage team members and roles.'
        }
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Filters and actions"
            filtersBadgeCount={filtersToolbarBadge}
            filters={
              <>
                <div className="relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5">
                  <FormSelect
                    value={currentStatusParam}
                    onChange={(e) => handleStatusChange(e.target.value)}
                    options={[
                      { value: 'ALL', label: 'All Status' },
                      { value: 'PENDING', label: 'Pending' },
                      { value: 'ACTIVE', label: 'Active' },
                      { value: 'INACTIVE', label: 'Inactive' },
                      { value: 'ARCHIVED', label: 'Archived' },
                      { value: 'DEACTIVATED', label: 'Deactivated' },
                    ]}
                    className="!bg-transparent !border-transparent !text-center" inlineChevron
                    controlSize="sm"
                    openAs="modal"
                    wrapperClassName="w-full"
                  />
                </div>
                <div className="relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5">
                  <SearchableSelect
                    id="users-role-filter-kebab"
                    value={currentRoleParam}
                    onChange={handleRoleChange}
                    options={ROLE_OPTIONS.map((r) => ({ value: r, label: r === 'ALL' ? 'All Roles' : formatRole(r) }))}
                    placeholder="All Roles"
                    searchPlaceholder="Search roles…"
                    triggerClassName="!bg-transparent !border-transparent !text-center" inlineChevron
                    wrapperClassName="w-full"
                  />
                </div>
                {branchPickerVisible ? (
                  <div className="relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5">
                    <SearchableSelect
                      id="users-branch-filter-kebab"
                      value={currentBranchParam}
                      onChange={handleBranchChange}
                      options={branchPickerOptions}
                      placeholder="All branches"
                      searchPlaceholder="Search branches…"
                      triggerClassName="!bg-transparent !border-transparent !text-center" inlineChevron
                      wrapperClassName="w-full"
                    />
                  </div>
                ) : null}
              </>
            }
            desktop={
              <>
                <PageRefreshButton />
                {staffAccounts ? (
                  // Staff accounts are created via Staff onboarding — no Add button here.
                  // Export is gated on `hr.export` (sensitive payout fields).
                  canExport ? (
                    <Button variant="secondary" size="sm" onClick={() => setShowExportModal(true)}>
                      Export
                    </Button>
                  ) : null
                ) : (
                  <ActionDropdown
                    id="add-user"
                    trigger="button"
                    triggerLabel="+ Add User"
                    triggerVariant="primary"
                    openMenuId={openHeaderMenuId}
                    setOpenMenuId={setOpenHeaderMenuId}
                    items={[
                      { label: 'Add manually', onClick: goToAddUser },
                      { label: 'Import from Excel', to: '/hr/users/import' },
                    ]}
                  />
                )}
              </>
            }
            sheet={({ closeSheet }) => (
              <>
                {staffAccounts ? (
                  canExport ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-12 w-full justify-center"
                      onClick={() => {
                        closeSheet();
                        setShowExportModal(true);
                      }}
                    >
                      Export staff accounts
                    </Button>
                  ) : null
                ) : (
                  <>
                    <BranchScopedLink
                      to={`${usersBasePath}/new`}
                      actionLabel="creating a user"
                      className="btn-primary btn-sm h-12 flex items-center justify-center w-full"
                      onClick={() => closeSheet()}
                    >
                      Add User
                    </BranchScopedLink>
                    <Link
                      to="/hr/users/import"
                      prefetch="intent"
                      onClick={closeSheet}
                      className="btn-secondary btn-sm h-12 flex items-center justify-center w-full"
                    >
                      Import users
                    </Link>
                  </>
                )}
              </>
            )}
          />
        }
      />

      {!staffAccounts && (
        rosterLoading ? (
          <OverviewStatStripSkeleton
            count={5}
            labels={['Total Users', 'Active', 'Pending', 'Inactive / Archived', 'Roles']}
            tileClassName="min-w-[6.5rem]"
          />
        ) : (
          <OverviewStatStrip
            mobileGrid
            tileClassName="min-w-[6.5rem]"
            items={[
              { label: 'Total Users', value: total, valueClassName: 'text-app-fg' },
              {
                label: 'Active',
                value: rosterSummary.active,
                valueClassName: 'text-success-600 dark:text-success-400',
                to: buildStatusQuery('ACTIVE'),
              },
              {
                label: 'Pending',
                value: rosterSummary.pending,
                valueClassName: 'text-info-600 dark:text-info-400',
                to: buildStatusQuery('PENDING'),
              },
              {
                label: 'Inactive / Archived',
                value: rosterSummary.inactiveArchived,
                valueClassName: 'text-app-fg',
              },
              { label: 'Roles', value: rosterSummary.distinctRoles, valueClassName: 'text-app-fg' },
            ]}
          />
        )
      )}

      {staffAccounts && (
        rosterLoading ? (
          <OverviewStatStripSkeleton
            count={2}
            labels={['Total matching', 'Page']}
            tileClassName="min-w-[6.5rem]"
          />
        ) : (
          <OverviewStatStrip
            mobileGrid
            tileClassName="min-w-[6.5rem]"
            items={[
              { label: 'Total matching', value: total, valueClassName: 'text-app-fg tabular-nums' },
              {
                label: 'Page',
                value: `${page} / ${safeTotalPages}`,
                valueClassName: 'text-app-fg-muted tabular-nums',
              },
            ]}
          />
        )
      )}

      {staffAccounts ? (
        <div className="list-panel flex flex-col">
          <ToolbarFiltersCollapsible
            className="!border-0"
            hideMobileSheet
            badgeCount={filtersToolbarBadge}
            searchRow={searchRow}
            desktopInlineFilters={
              <>
                <div className="relative">
                  {currentStatusParam !== 'ALL' && (
                    <FilterDismiss onClear={() => handleStatusChange('ALL')} />
                  )}
                  <FormSelect
                    value={currentStatusParam}
                    onChange={(e) => handleStatusChange(e.target.value)}
                    options={[
                      { value: 'ALL', label: 'All Status' },
                      { value: 'PENDING', label: 'Pending' },
                      { value: 'ACTIVE', label: 'Active' },
                      { value: 'INACTIVE', label: 'Inactive' },
                      { value: 'ARCHIVED', label: 'Archived' },
                      { value: 'DEACTIVATED', label: 'Deactivated' },
                    ]}
                    wrapperClassName="w-full min-w-0 sm:w-40"
                  />
                </div>
                <div className="relative">
                  {currentRoleParam !== 'ALL' && (
                    <FilterDismiss onClear={() => handleRoleChange('ALL')} />
                  )}
                  <SearchableSelect
                    id="users-role-filter-staff-desktop"
                    value={currentRoleParam}
                    onChange={handleRoleChange}
                    options={ROLE_OPTIONS.map((r) => ({ value: r, label: r === 'ALL' ? 'All Roles' : formatRole(r) }))}
                    placeholder="All Roles"
                    searchPlaceholder="Search roles…"
                    wrapperClassName="w-full min-w-0 sm:w-48"
                  />
                </div>
                {branchPickerVisible ? (
                  <div className="relative">
                    {currentBranchParam !== 'ALL' && (
                      <FilterDismiss onClear={() => handleBranchChange('ALL')} />
                    )}
                    <SearchableSelect
                      id="users-staff-branch-filter"
                      value={currentBranchParam}
                      onChange={handleBranchChange}
                      options={branchPickerOptions}
                      placeholder="All branches"
                      searchPlaceholder="Search branches…"
                      wrapperClassName="w-full min-w-0 sm:w-52"
                    />
                  </div>
                ) : null}
              </>
            }
            sheetFilterBody={
              <>
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-app-fg-muted">Status</span>
                  <div className="relative">
                    {currentStatusParam !== 'ALL' && (
                      <FilterDismiss onClear={() => handleStatusChange('ALL')} />
                    )}
                    <FormSelect
                      value={currentStatusParam}
                      onChange={(e) => handleStatusChange(e.target.value)}
                      options={[
                        { value: 'ALL', label: 'All Status' },
                        { value: 'PENDING', label: 'Pending' },
                        { value: 'ACTIVE', label: 'Active' },
                        { value: 'INACTIVE', label: 'Inactive' },
                        { value: 'ARCHIVED', label: 'Archived' },
                        { value: 'DEACTIVATED', label: 'Deactivated' },
                      ]}
                      wrapperClassName="w-full"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-app-fg-muted">Role</span>
                  <div className="relative">
                    {currentRoleParam !== 'ALL' && (
                      <FilterDismiss onClear={() => handleRoleChange('ALL')} />
                    )}
                    <SearchableSelect
                      id="users-role-filter-staff-sheet"
                      value={currentRoleParam}
                      onChange={handleRoleChange}
                      options={ROLE_OPTIONS.map((r) => ({ value: r, label: r === 'ALL' ? 'All Roles' : formatRole(r) }))}
                      placeholder="All Roles"
                      searchPlaceholder="Search roles…"
                      wrapperClassName="w-full"
                    />
                  </div>
                </div>
                {branchPickerVisible ? (
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-app-fg-muted">Branch</span>
                    <div className="relative">
                      {currentBranchParam !== 'ALL' && (
                        <FilterDismiss onClear={() => handleBranchChange('ALL')} />
                      )}
                      <SearchableSelect
                        id="users-staff-branch-filter-sheet"
                        value={currentBranchParam}
                        onChange={handleBranchChange}
                        options={branchPickerOptions}
                        placeholder="All branches"
                        searchPlaceholder="Search branches…"
                        wrapperClassName="w-full"
                      />
                    </div>
                  </div>
                ) : null}
              </>
            }
          />
          {rosterLoading ? (
            <CompactTable<{ id: string }>
              key="staff-skeleton"
              columns={hrUsersShellColumns(true)}
              rows={shellPulsePlaceholderRows('staff_accounts', SKELETON_ROW_COUNT)}
              rowKey={(r) => r.id}
              withCard={false}
              emptyTitle="Loading…"
              emptyDescription=""
              pagination={{
                page: 1,
                totalPages: 1,
                onPageChange: () => undefined,
                summary: <span className="text-app-fg-muted">Loading staff…</span>,
                wrapperClassName:
                  'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-3 pb-3 pt-1 opacity-60',
              }}
            />
          ) : (
            <CompactTable<User>
              key="staff"
              columns={staffAccountsColumns}
              rows={users}
              rowKey={(u) => u.id}
              withCard={false}
              loading={isFilterLoading}
              loadingVariant="overlay"
              emptyTitle={users.length === 0 ? 'No staff found' : 'No matching staff'}
              emptyDescription={
                users.length === 0
                  ? 'Staff records will appear here once added in HR.'
                  : 'Try a different search or filters.'
              }
              renderMobileCard={(user) => (
                <button
                  type="button"
                  onClick={() => setPreviewUser(user)}
                  className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5 text-left"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <CompactUserAvatar name={user.name} />
                      <span className="font-medium text-app-fg truncate">{user.name}</span>
                    </div>
                    <RoleBadge variant="text" role={user.role} label={formatRole(user.role)} />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-app-fg-muted truncate">
                    {user.payoutBankName?.trim() ? <span>{user.payoutBankName}</span> : null}
                    {user.payoutAccountNumber?.trim() ? (
                      <span className="font-mono tabular-nums">{user.payoutAccountNumber}</span>
                    ) : null}
                    {!user.payoutBankName?.trim() && !user.payoutAccountNumber?.trim() ? <span>No account details</span> : null}
                  </div>
                </button>
              )}
              pagination={{
                page,
                totalPages: safeTotalPages,
                onPageChange: goToPage,
                pageSize,
                pageSizeOptions,
                summary: (
                  <span>
                    Showing {users.length} of {total} staff
                  </span>
                ),
                wrapperClassName:
                  'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-3 pb-3 pt-1',
              }}
            />
          )}
        </div>
      ) : (
        <>
          <div className="list-panel">
            <ToolbarFiltersCollapsible
              className="!border-0"
              hideMobileSheet
              badgeCount={filtersToolbarBadge}
              sheetSubtitle={
                <span>Search runs on the full roster server-side. Status and role reload the list.</span>
              }
              searchRow={searchRow}
              desktopInlineFilters={
                <>
                  <div className="relative">
                    {currentStatusParam !== 'ALL' && (
                      <FilterDismiss onClear={() => handleStatusChange('ALL')} />
                    )}
                    <FormSelect
                      value={currentStatusParam}
                      onChange={(e) => handleStatusChange(e.target.value)}
                      options={[
                        { value: 'ALL', label: 'All Status' },
                        { value: 'PENDING', label: 'Pending' },
                        { value: 'ACTIVE', label: 'Active' },
                        { value: 'INACTIVE', label: 'Inactive' },
                        { value: 'ARCHIVED', label: 'Archived' },
                        { value: 'DEACTIVATED', label: 'Deactivated' },
                      ]}
                      wrapperClassName="w-full min-w-0 sm:w-40"
                    />
                  </div>
                  <div className="relative">
                    {currentRoleParam !== 'ALL' && (
                      <FilterDismiss onClear={() => handleRoleChange('ALL')} />
                    )}
                    <SearchableSelect
                      id="users-role-filter-hr-desktop"
                      value={currentRoleParam}
                      onChange={handleRoleChange}
                      options={ROLE_OPTIONS.map((r) => ({ value: r, label: r === 'ALL' ? 'All Roles' : formatRole(r) }))}
                      placeholder="All Roles"
                      searchPlaceholder="Search roles…"
                      wrapperClassName="w-full min-w-0 sm:w-48"
                    />
                  </div>
                  {branchPickerVisible ? (
                    <div className="relative">
                      {currentBranchParam !== 'ALL' && (
                        <FilterDismiss onClear={() => handleBranchChange('ALL')} />
                      )}
                      <SearchableSelect
                        id="users-hr-branch-filter"
                        value={currentBranchParam}
                        onChange={handleBranchChange}
                        options={branchPickerOptions}
                        placeholder="All branches"
                        searchPlaceholder="Search branches…"
                        wrapperClassName="w-full min-w-0 sm:w-52"
                      />
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleProbationOnlyToggle(!probationOnly)}
                    className={`px-3 py-1.5 rounded-md border text-xs font-medium whitespace-nowrap transition-colors ${
                      probationOnly
                        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700'
                        : 'bg-app-surface border-app-border text-app-fg-muted hover:bg-app-hover'
                    }`}
                  >
                    Probation only
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSupervisorOnlyToggle(!supervisorOnly)}
                    className={`px-3 py-1.5 rounded-md border text-xs font-medium whitespace-nowrap transition-colors ${
                      supervisorOnly
                        ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200 border-purple-300 dark:border-purple-700'
                        : 'bg-app-surface border-app-border text-app-fg-muted hover:bg-app-hover'
                    }`}
                  >
                    Supervisors only
                  </button>
                </>
              }
              sheetFilterBody={
                <>
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-app-fg-muted">Status</span>
                    <div className="relative">
                      {currentStatusParam !== 'ALL' && (
                        <FilterDismiss onClear={() => handleStatusChange('ALL')} />
                      )}
                      <FormSelect
                        value={currentStatusParam}
                        onChange={(e) => handleStatusChange(e.target.value)}
                        options={[
                          { value: 'ALL', label: 'All Status' },
                          { value: 'PENDING', label: 'Pending' },
                          { value: 'ACTIVE', label: 'Active' },
                          { value: 'INACTIVE', label: 'Inactive' },
                          { value: 'ARCHIVED', label: 'Archived' },
                          { value: 'DEACTIVATED', label: 'Deactivated' },
                        ]}
                        wrapperClassName="w-full"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-app-fg-muted">Role</span>
                    <div className="relative">
                      {currentRoleParam !== 'ALL' && (
                        <FilterDismiss onClear={() => handleRoleChange('ALL')} />
                      )}
                      <SearchableSelect
                        id="users-role-filter-hr-sheet"
                        value={currentRoleParam}
                        onChange={handleRoleChange}
                        options={ROLE_OPTIONS.map((r) => ({ value: r, label: r === 'ALL' ? 'All Roles' : formatRole(r) }))}
                        placeholder="All Roles"
                        searchPlaceholder="Search roles…"
                        wrapperClassName="w-full"
                      />
                    </div>
                  </div>
                  {branchPickerVisible ? (
                    <div className="space-y-1.5">
                      <span className="text-xs font-medium text-app-fg-muted">Branch</span>
                      <div className="relative">
                        {currentBranchParam !== 'ALL' && (
                          <FilterDismiss onClear={() => handleBranchChange('ALL')} />
                        )}
                        <SearchableSelect
                          id="users-hr-branch-filter-sheet"
                          value={currentBranchParam}
                          onChange={handleBranchChange}
                          options={branchPickerOptions}
                          placeholder="All branches"
                          searchPlaceholder="Search branches…"
                          wrapperClassName="w-full"
                        />
                      </div>
                    </div>
                  ) : null}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={probationOnly}
                      onChange={(e) => handleProbationOnlyToggle(e.target.checked)}
                    />
                    <span className="text-sm text-app-fg">Show probation users only</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={supervisorOnly}
                      onChange={(e) => handleSupervisorOnlyToggle(e.target.checked)}
                    />
                    <span className="text-sm text-app-fg">Show team supervisors only</span>
                  </label>
                </>
              }
            />
          </div>

          {rosterLoading ? (
            <CompactTable<{ id: string }>
              key="hr-skeleton"
              columns={hrUsersShellColumns(false)}
              rows={shellPulsePlaceholderRows('hr_users', SKELETON_ROW_COUNT)}
              rowKey={(r) => r.id}
              emptyTitle="Loading…"
              emptyDescription=""
              pagination={{
                page: 1,
                totalPages: 1,
                onPageChange: () => undefined,
                summary: <span className="text-app-fg-muted">Loading users…</span>,
                wrapperClassName:
                  'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-3 pb-3 pt-1 opacity-60',
              }}
            />
          ) : (
            <CompactTable<User>
              key="hr"
              columns={hrUserColumns}
              rows={users}
              rowKey={(u) => u.id}
              loading={isFilterLoading}
              loadingVariant="overlay"
              emptyTitle={users.length === 0 ? 'No users yet' : 'No matching users found'}
              emptyDescription={
                users.length === 0 ? 'Add your first team member.' : 'Try adjusting your search or filters.'
              }
              renderMobileCard={(user) => (
                <button
                  type="button"
                  onClick={() => setPreviewUser(user)}
                  className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5 text-left"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <CompactUserAvatar name={user.name} />
                      <span className="font-medium text-app-fg truncate">{user.name}</span>
                    </div>
                    <StatusBadge status={user.status} />
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <RoleBadge variant="text" role={user.role} label={formatRole(user.role)} />
                    {user.isTeamSupervisor && <SupervisorBadge size="sm" />}
                    {user.isProbation && <ProbationBadge until={user.probationUntil ?? null} size="sm" showDaysRemaining={false} />}
                  </div>
                  <div className="text-xs text-app-fg-muted truncate">{user.email}</div>
                </button>
              )}
              pagination={{
                page,
                totalPages: safeTotalPages,
                onPageChange: goToPage,
                pageSize,
                pageSizeOptions,
                summary: (
                  <span>
                    Showing {users.length} of {total} users
                  </span>
                ),
                wrapperClassName:
                  'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-3 pb-3 pt-1',
              }}
            />
          )}
        </>
      )}

      {/* Resend invite confirmation — guards against fat-finger sends from a long table.
          Resending generates a fresh temporary password and invalidates any prior link. */}
      {resendConfirm && (
        <ConfirmActionModal
          open
          onClose={() => {
            if (!isResending) setResendConfirm(null);
          }}
          title="Resend invite?"
          description={
            <>
              Send a new invite to <strong className="text-app-fg">{resendConfirm.name}</strong> at{' '}
              <span className="font-mono text-xs">{resendConfirm.email}</span>? This generates a
              fresh temporary password and invalidates any previously sent link.
            </>
          }
          confirmLabel="Resend invite"
          cancelLabel="Cancel"
          variant="warning"
          loading={isResending}
          error={!isResending && resendFetcher.data?.error ? resendFetcher.data.error : null}
          onConfirm={() => {
            resendFetcher.submit(
              { intent: 'resendInvite', userId: resendConfirm.id },
              { method: 'post' },
            );
            // Modal stays open through the submit so the user sees the spinner; close once
            // the fetcher returns success — handled below.
          }}
        />
      )}
      <ResendInviteAutoClose
        fetcher={resendFetcher}
        onClose={() => setResendConfirm(null)}
      />
      {staffAccounts && canExport && (
        <LocalExportModal
          open={showExportModal}
          onClose={() => setShowExportModal(false)}
          title="Export staff accounts"
          description={`Exports the ${users.length} staff ${users.length === 1 ? 'account' : 'accounts'} on this page, including payout and bank details.`}
          rows={staffExportRows}
          columns={staffExportColumns}
          defaultColumns={staffExportColumns.map((c) => c.key)}
          filenamePrefix="staff-accounts"
        />
      )}
      {/* The legacy <UsersImportModal/> render-block lived here. Removed
          alongside the new dedicated /hr/users/import page (CEO directive
          2026-05-11). The list auto-refreshes when the user navigates back
          from /hr/users/import via Remix's normal loader cycle. */}

      {/* Mobile user preview modal */}
      <Modal
        open={!!previewUser}
        onClose={() => setPreviewUser(null)}
        maxWidth="max-w-sm"
        contentClassName="p-5"
      >
        {previewUser && (() => {
          const u = previewUser;
          return (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-center gap-3">
                <CompactUserAvatar name={u.name} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-app-fg truncate">{u.name}</p>
                  <p className="text-xs text-app-fg-muted truncate">{u.email}</p>
                </div>
                <StatusBadge status={u.status} />
              </div>

              {/* Details */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Role</span>
                  <RoleBadge variant="text" role={u.role} label={formatRole(u.role)} />
                </div>
                {u.branchMemberships && u.branchMemberships.length > 0 && (
                  <div>
                    <span className="text-app-fg-muted text-sm">Branches</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      <UserBranchBadges branches={u.branchMemberships} />
                    </div>
                  </div>
                )}
                {u.isTeamSupervisor && (
                  <div className="flex justify-between">
                    <span className="text-app-fg-muted">Supervisor</span>
                    <SupervisorBadge size="sm" />
                  </div>
                )}
                {u.isProbation && (
                  <div className="flex justify-between">
                    <span className="text-app-fg-muted">Probation</span>
                    <ProbationBadge until={u.probationUntil ?? null} size="sm" showDaysRemaining />
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Joined</span>
                  <span className="text-app-fg">
                    {new Date(u.createdAt).toLocaleDateString('en-NG', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </div>
                {staffAccounts && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-app-fg-muted">Bank</span>
                      <span className="text-app-fg">{u.payoutBankName?.trim() || '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-app-fg-muted">Account name</span>
                      <span className="text-app-fg">{u.payoutAccountName?.trim() || '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-app-fg-muted">Account number</span>
                      <span className="font-mono tabular-nums text-app-fg">{u.payoutAccountNumber?.trim() || '—'}</span>
                    </div>
                    {u.payoutBankCode?.trim() && (
                      <div className="flex justify-between">
                        <span className="text-app-fg-muted">Bank code</span>
                        <span className="font-mono tabular-nums text-app-fg-muted">{u.payoutBankCode}</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1 border-t border-app-border">
                {!staffAccounts && u.status === 'PENDING' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    disabled={isResending}
                    onClick={() => {
                      setPreviewUser(null);
                      setResendConfirm({ id: u.id, name: u.name, email: u.email });
                    }}
                  >
                    Resend invite
                  </Button>
                )}
                <Link
                  to={`${usersBasePath}/${u.id}`}
                  prefetch="intent"
                  className="btn-primary btn-sm inline-flex flex-1 items-center justify-center"
                  onClick={() => setPreviewUser(null)}
                >
                  View details
                </Link>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}

/** Closes the resend-invite modal once the fetcher reports success. Watches the fetcher's
 *  data through a ref so the effect fires once per response instead of on every render. */
function ResendInviteAutoClose({
  fetcher,
  onClose,
}: {
  fetcher: ReturnType<typeof useFetcher<{ success?: boolean; error?: string }>>;
  onClose: () => void;
}) {
  const lastSeenRef = useRef<unknown>(null);
  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data) return;
    if (fetcher.data === lastSeenRef.current) return;
    lastSeenRef.current = fetcher.data;
    if (fetcher.data.success) onClose();
  }, [fetcher.state, fetcher.data, onClose]);
  return null;
}
