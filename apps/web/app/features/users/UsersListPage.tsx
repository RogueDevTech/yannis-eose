import { useState } from 'react';
import { Link, useSearchParams, useNavigation } from '@remix-run/react';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { SearchInput } from '~/components/ui/search-input';
import { FormSelect } from '~/components/ui/form-select';
import { EmptyState } from '~/components/ui/empty-state';
import { StatusBadge } from '~/components/ui/status-badge';
import { Pagination } from '~/components/ui/pagination';
import type { User } from './types';
import { ROLE_OPTIONS, formatRole } from './types';
import { UserBranchBadges } from '~/components/ui/user-branch-badges';

interface UsersListPageProps {
  users: User[];
  total: number;
  page: number;
  totalPages: number;
  statusParam?: string;
  roleParam?: string;
}

export function UsersListPage({
  users,
  total,
  page,
  totalPages,
  statusParam = 'ALL',
  roleParam = 'ALL',
}: UsersListPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const navigation = useNavigation();
  const isFilterLoading = navigation.state === 'loading';
  const safeTotalPages = Math.max(1, totalPages);

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

  const filteredUsers = users.filter((user) => {
    if (statusParam !== 'ALL' && user.status !== statusParam) return false;
    if (roleParam !== 'ALL' && user.role !== roleParam) return false;
    if (
      searchQuery &&
      !user.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !user.email.toLowerCase().includes(searchQuery.toLowerCase())
    )
      return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Page header */}
      <PageHeader
        title="Users"
        description="Manage team members and their roles"
        actions={
          <Link to="/hr/users/new" className="btn-primary">
            <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add User
          </Link>
        }
      />

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

      {/* Filters bar */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by name or email..."
            className="flex-1"
          />
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
            className="w-full sm:w-40"
          />
          <FormSelect
            value={roleParam}
            onChange={(e) => handleRoleChange(e.target.value)}
            options={ROLE_OPTIONS.map((r) => ({ value: r, label: r === 'ALL' ? 'All Roles' : formatRole(r) }))}
            className="w-full sm:w-48"
          />
        </div>
      </div>

      {/* Users table */}
      <div className="card p-0 overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Name</th>
                <th className="table-header">Email</th>
                <th className="table-header">Role</th>
                <th className="table-header">Branches</th>
                <th className="table-header">Status</th>
                <th className="table-header text-center">Capacity</th>
                <th className="table-header">Joined</th>
                <th className="table-header text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id} className="table-row">
                  <td className="table-cell">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-semibold text-white">
                          {user.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <span className="font-medium text-app-fg">{user.name}</span>
                    </div>
                  </td>
                  <td className="table-cell text-app-fg-muted">{user.email}</td>
                  <td className="table-cell">
                    <StatusBadge status={user.role} label={formatRole(user.role)} />
                  </td>
                  <td className="table-cell">
                    <UserBranchBadges branches={user.branchMemberships} compact />
                  </td>
                  <td className="table-cell">
                    <StatusBadge status={user.status} />
                  </td>
                  <td className="table-cell text-center">{user.capacity}</td>
                  <td className="table-cell text-app-fg-muted">
                    {new Date(user.createdAt).toLocaleDateString('en-NG', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="table-cell text-right">
                    <Link
                      to={`/hr/users/${user.id}`}
                      className="btn-secondary btn-sm"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      title={users.length === 0 ? 'No users yet' : 'No matching users found'}
                      description={users.length === 0 ? 'Add your first team member.' : 'Try adjusting your search or filters.'}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile card list */}
        <div className="md:hidden space-y-3 px-1">
          {filteredUsers.map((user) => (
            <Link
              key={user.id}
              to={`/hr/users/${user.id}`}
              className="block rounded-lg border border-app-border bg-app-elevated p-4 hover:bg-app-hover/50 transition-colors"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-full bg-brand-500 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-semibold text-white">
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-app-fg truncate">{user.name}</p>
                  <p className="text-sm text-app-fg-muted truncate">{user.email}</p>
                </div>
                <StatusBadge status={user.status} />
              </div>
              <div className="flex items-center justify-between">
                <StatusBadge status={user.role} label={formatRole(user.role)} />
                <span className="text-xs text-app-fg-muted">
                  {new Date(user.createdAt).toLocaleDateString('en-NG', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </div>
              <div className="mt-2">
                <UserBranchBadges branches={user.branchMemberships} compact />
              </div>
            </Link>
          ))}
          {filteredUsers.length === 0 && (
            <EmptyState
              title={users.length === 0 ? 'No users yet' : 'No matching users found'}
            />
          )}
        </div>
      </div>

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-sm text-app-fg-muted">
          Showing {filteredUsers.length} of {total} users
        </p>
        <Pagination page={page} totalPages={safeTotalPages} onPageChange={goToPage} showLabel />
      </div>
    </div>
  );
}
