import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams, useFetcher } from '@remix-run/react';
import { BranchScopedLink } from '~/components/ui/branch-scoped-link';
import { CompactTable, CompactTableActionButton, type CompactTableColumn } from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { SearchInput } from '~/components/ui/search-input';
import { FormSelect } from '~/components/ui/form-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { useFetcherToast } from '~/components/ui/toast';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import type { User } from './types';
import { ROLE_OPTIONS, formatRole } from './types';
import { RoleBadge } from '~/components/ui/role-badge';
import { ProbationBadge } from '~/components/ui/probation-badge';
import { UserBranchBadges } from '~/components/ui/user-branch-badges';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { TableActionButton } from '~/components/ui/table-action-button';

interface UsersListPageProps {
  users: User[];
  total: number;
  page: number;
  totalPages: number;
  statusParam?: string;
  roleParam?: string;
  usersBasePath?: string;
  /** Finance roster: name + payment contact only — no HR stats, role grid, or invite actions. */
  variant?: 'default' | 'staffAccounts';
}

export function UsersListPage({
  users,
  total,
  page,
  totalPages,
  statusParam = 'ALL',
  roleParam = 'ALL',
  usersBasePath = '/hr/users',
  variant = 'default',
}: UsersListPageProps) {
  const staffAccounts = variant === 'staffAccounts';
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const isFilterLoading = useLoaderRefetchBusy().busy;
  const safeTotalPages = Math.max(1, totalPages);
  const resendFetcher = useFetcher<{ success?: boolean; error?: string; intent?: string }>();
  useFetcherToast(resendFetcher.data, { successMessage: 'Invite re-sent with new credentials' });
  // Confirmation modal — Resend invite mutates the user's password (a fresh temp password is
  // generated and emailed) which invalidates any older invite link. Easy to fire by accident
  // from a long table, so confirm before sending.
  const [resendConfirm, setResendConfirm] = useState<{ id: string; name: string; email: string } | null>(null);
  const isResending = resendFetcher.state !== 'idle';

  const handleStatusChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === 'ALL') next.delete('status');
    else next.set('status', value);
    next.set('page', '1');
    setSearchParams(next, { replace: true });
  };

  const handleRoleChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === 'ALL') next.delete('role');
    else next.set('role', value);
    next.set('page', '1');
    setSearchParams(next, { replace: true });
  };

  const goToPage = (nextPage: number) => {
    const clamped = Math.min(Math.max(1, nextPage), safeTotalPages);
    const next = new URLSearchParams(searchParams);
    next.set('page', String(clamped));
    setSearchParams(next, { replace: true });
  };

  const filtersToolbarBadge = useMemo(() => {
    let n = 0;
    if (statusParam !== 'ALL') n += 1;
    if (roleParam !== 'ALL') n += 1;
    if (searchParams.get('probationOnly') === '1') n += 1;
    return n;
  }, [statusParam, roleParam, searchParams]);

  const probationOnly = searchParams.get('probationOnly') === '1';
  const handleProbationOnlyToggle = (next: boolean) => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set('probationOnly', '1');
    else params.delete('probationOnly');
    params.set('page', '1');
    setSearchParams(params, { replace: true });
  };

  const q = searchQuery.trim().toLowerCase();
  const filteredUsers = users.filter((user) => {
    if (statusParam !== 'ALL' && user.status !== statusParam) return false;
    if (roleParam !== 'ALL' && user.role !== roleParam) return false;
    if (probationOnly && !user.isProbation) return false;
    if (!q) return true;
    if (user.name.toLowerCase().includes(q)) return true;
    if (user.email.toLowerCase().includes(q)) return true;
    const phone = user.phone?.toLowerCase() ?? '';
    if (phone && phone.includes(q)) return true;
    return false;
  });

  const staffAccountsColumns: CompactTableColumn<User>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        render: (user) => (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center shrink-0">
              <span className="text-xs font-semibold text-white">{user.name.charAt(0).toUpperCase()}</span>
            </div>
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

  const hrUserColumns: CompactTableColumn<User>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        render: (user) => (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center shrink-0">
              <span className="text-xs font-semibold text-white">{user.name.charAt(0).toUpperCase()}</span>
            </div>
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
        title={staffAccounts ? 'Staff accounts' : 'Users'}
        description={
          staffAccounts
            ? 'Staff names and payout bank details (account name, number, bank code) for disbursement.'
            : 'Manage team members and their roles'
        }
        actions={
          <PageHeaderMobileTools
            sheetTitle={staffAccounts ? 'Staff accounts' : 'Users tools'}
            sheetSubtitle={<span>Refresh and add user</span>}
            triggerAriaLabel={staffAccounts ? 'Staff accounts toolbar' : 'Users toolbar'}
            desktop={
              <>
                <PageRefreshButton />
                <BranchScopedLink
                  to={`${usersBasePath}/new`}
                  actionLabel="creating a user"
                  className="btn-primary"
                >
                  <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  {staffAccounts ? 'Add staff' : 'Add User'}
                </BranchScopedLink>
              </>
            }
            sheet={({ closeSheet }) => (
              <BranchScopedLink
                to={`${usersBasePath}/new`}
                actionLabel="creating a user"
                className="btn-primary inline-flex w-full items-center justify-center gap-2"
                onClick={() => closeSheet()}
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                {staffAccounts ? 'Add staff' : 'Add User'}
              </BranchScopedLink>
            )}
          />
        }
      />

      {!staffAccounts && (
        <OverviewStatStrip
          tileClassName="min-w-[6.5rem]"
          items={[
            { label: 'Total Users', value: total, valueClassName: 'text-app-fg' },
            {
              label: 'Active',
              value: users.filter((u) => u.status === 'ACTIVE').length,
              valueClassName: 'text-success-600 dark:text-success-400',
            },
            {
              label: 'Pending',
              value: users.filter((u) => u.status === 'PENDING').length,
              valueClassName: 'text-info-600 dark:text-info-400',
            },
            {
              label: 'Inactive / Archived',
              value: users.filter((u) => u.status === 'INACTIVE' || u.status === 'ARCHIVED').length,
              valueClassName: 'text-app-fg',
            },
            { label: 'Roles', value: new Set(users.map((u) => u.role)).size, valueClassName: 'text-app-fg' },
          ]}
        />
      )}

      {staffAccounts && (
        <OverviewStatStrip
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
      )}

      {staffAccounts ? (
        <div className="card p-0 overflow-hidden flex flex-col">
          <ToolbarFiltersCollapsible
            className="!border-0"
            badgeCount={filtersToolbarBadge}
            sheetSubtitle={<span>Status and role reload the list from the server. Search narrows the current page.</span>}
            searchRow={
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search by name, email, or phone…"
                wrapperClassName="min-w-0 flex-1 md:min-w-0"
              />
            }
            desktopInlineFilters={
              <>
                <FormSelect
                  value={statusParam}
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
                <FormSelect
                  value={roleParam}
                  onChange={(e) => handleRoleChange(e.target.value)}
                  options={ROLE_OPTIONS.map((r) => ({ value: r, label: r === 'ALL' ? 'All Roles' : formatRole(r) }))}
                  wrapperClassName="w-full min-w-0 sm:w-48"
                />
              </>
            }
            sheetFilterBody={
              <>
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-app-fg-muted">Status</span>
                  <FormSelect
                    value={statusParam}
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
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-app-fg-muted">Role</span>
                  <FormSelect
                    value={roleParam}
                    onChange={(e) => handleRoleChange(e.target.value)}
                    options={ROLE_OPTIONS.map((r) => ({ value: r, label: r === 'ALL' ? 'All Roles' : formatRole(r) }))}
                    wrapperClassName="w-full"
                  />
                </div>
              </>
            }
          />
          <CompactTable<User>
            key="staff"
            columns={staffAccountsColumns}
            rows={filteredUsers}
            rowKey={(u) => u.id}
            withCard={false}
            loading={isFilterLoading}
            loadingVariant="overlay"
            emptyTitle={
              users.length === 0 ? 'No staff found' : 'No matching staff'
            }
            emptyDescription={
              users.length === 0
                ? 'Staff records will appear here once added in HR.'
                : 'Try a different search or filters.'
            }
            pagination={{
              page,
              totalPages: safeTotalPages,
              onPageChange: goToPage,
              summary: (
                <span>
                  Showing {filteredUsers.length} of {total} staff
                </span>
              ),
              wrapperClassName: 'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-3 pb-3 pt-1',
            }}
          />
        </div>
      ) : (
        <>
          <div className="card p-0 overflow-hidden">
            <ToolbarFiltersCollapsible
              className="!border-0"
              badgeCount={filtersToolbarBadge}
              sheetSubtitle={<span>Status and role apply immediately</span>}
              searchRow={
                <SearchInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Search by name or email..."
                  wrapperClassName="min-w-0 flex-1 md:min-w-0"
                />
              }
              desktopInlineFilters={
                <>
                  <FormSelect
                    value={statusParam}
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
                  <FormSelect
                    value={roleParam}
                    onChange={(e) => handleRoleChange(e.target.value)}
                    options={ROLE_OPTIONS.map((r) => ({ value: r, label: r === 'ALL' ? 'All Roles' : formatRole(r) }))}
                    wrapperClassName="w-full min-w-0 sm:w-48"
                  />
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
                </>
              }
              sheetFilterBody={
                <>
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-app-fg-muted">Status</span>
                    <FormSelect
                      value={statusParam}
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
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-app-fg-muted">Role</span>
                    <FormSelect
                      value={roleParam}
                      onChange={(e) => handleRoleChange(e.target.value)}
                      options={ROLE_OPTIONS.map((r) => ({ value: r, label: r === 'ALL' ? 'All Roles' : formatRole(r) }))}
                      wrapperClassName="w-full"
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={probationOnly}
                      onChange={(e) => handleProbationOnlyToggle(e.target.checked)}
                    />
                    <span className="text-sm text-app-fg">Show probation users only</span>
                  </label>
                </>
              }
            />
          </div>

          <CompactTable<User>
            key="hr"
            columns={hrUserColumns}
            rows={filteredUsers}
            rowKey={(u) => u.id}
            loading={isFilterLoading}
            loadingVariant="overlay"
            emptyTitle={
              users.length === 0 ? 'No users yet' : 'No matching users found'
            }
            emptyDescription={
              users.length === 0 ? 'Add your first team member.' : 'Try adjusting your search or filters.'
            }
            pagination={{
              page,
              totalPages: safeTotalPages,
              onPageChange: goToPage,
              summary: (
                <span>
                  Showing {filteredUsers.length} of {total} users
                </span>
              ),
              wrapperClassName: 'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-3 pb-3 pt-1',
            }}
          />
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
