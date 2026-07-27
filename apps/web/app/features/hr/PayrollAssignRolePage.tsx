import { useCallback, useMemo, useState } from 'react';
import { useFetcher, useSearchParams } from '@remix-run/react';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { PageSearchControl } from '~/components/ui/page-search-control';
import { FormSelect } from '~/components/ui/form-select';
import { EmptyState } from '~/components/ui/empty-state';
import { Button } from '~/components/ui/button';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { Pagination } from '~/components/ui/pagination';
import { StatusBadge } from '~/components/ui/status-badge';
import {
  CompactTable,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { useFetcherToast } from '~/components/ui/toast';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { RoleBadge } from '~/components/ui/role-badge';
import { invalidateCachedLoader } from '~/lib/loader-cache';
import type { PayRole } from './payroll-prd-types';
import type { BranchOption } from './types';

interface StaffRow {
  id: string;
  name: string;
  role: string;
  payRoleId: string | null;
}

interface PayrollAssignRolePageProps {
  payRole: PayRole;
  allRoles: PayRole[];
  staff: StaffRow[];
  total: number;
  page: number;
  limit: number;
  branches: BranchOption[];
  canWrite: boolean;
  filters: {
    role?: string;
    branchId?: string;
    search?: string;
    assignStatus?: string;
  };
}

const ROLE_FILTER_OPTIONS = [
  { value: '', label: 'All roles' },
  { value: 'SUPER_ADMIN', label: 'Super Admin' },
  { value: 'ADMIN', label: 'Admin' },
  { value: 'BRANCH_ADMIN', label: 'Branch Admin' },
  { value: 'HEAD_OF_MARKETING', label: 'Head of Marketing' },
  { value: 'MEDIA_BUYER', label: 'Media Buyer' },
  { value: 'HEAD_OF_CS', label: 'Head of CS' },
  { value: 'CS_CLOSER', label: 'CS Closer' },
  { value: 'FINANCE_OFFICER', label: 'Finance Officer' },
  { value: 'HEAD_OF_LOGISTICS', label: 'Head of Logistics' },
  { value: 'STOCK_MANAGER', label: 'Stock Manager' },
  { value: 'TPL_MANAGER', label: 'TPL Manager' },
  { value: 'TPL_RIDER', label: 'TPL Rider' },
  { value: 'HR_MANAGER', label: 'HR Manager' },
  { value: 'SUPPORT', label: 'Support' },
  { value: 'AUDITOR', label: 'Auditor' },
];

const ASSIGN_STATUS_OPTIONS = [
  { value: '', label: 'All assignment status' },
  { value: 'unassigned', label: 'No pay role' },
  { value: 'assigned_other', label: 'Assigned to other role' },
  { value: 'assigned_this', label: 'Already on this role' },
];

function PayRoleStatusCell({
  row,
  payRoleId,
  payRoleById,
}: {
  row: StaffRow;
  payRoleId: string;
  payRoleById: Map<string, string>;
}) {
  if (row.payRoleId === payRoleId) {
    return <StatusBadge status="ASSIGNED" label="Already assigned" variant="success" size="sm" />;
  }
  if (row.payRoleId) {
    return <span className="text-sm text-app-fg-muted">{payRoleById.get(row.payRoleId) ?? 'Other role'}</span>;
  }
  return <StatusBadge status="UNASSIGNED" label="No pay role" variant="warning" size="sm" />;
}

export function PayrollAssignRolePage({
  payRole,
  allRoles,
  staff,
  total,
  page,
  limit,
  branches,
  canWrite,
  filters,
}: PayrollAssignRolePageProps) {
  const [, setSearchParams] = useSearchParams();
  const fetcher = useFetcher<{ success?: boolean; error?: string; assignedCount?: number }>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAssignConfirm, setShowAssignConfirm] = useState(false);

  useFetcherToast(fetcher.data, {
    successMessage: fetcher.data?.assignedCount
      ? `${fetcher.data.assignedCount} staff assigned successfully`
      : 'Staff assigned successfully',
  });

  useCloseOnFetcherSuccess(fetcher, () => {
    const assignedIds = [...selected];
    setShowAssignConfirm(false);
    setSelected(new Set());
    // Drop stale edit-profile caches so the next Edit Profile visit shows the
    // newly assigned pay role.
    for (const id of assignedIds) {
      invalidateCachedLoader(`/hr/users/${id}/edit`);
      invalidateCachedLoader(`/hr/users/${id}`);
    }
    window.location.href = '/hr/payroll/config/roles';
  });

  const payRoleById = useMemo(() => new Map(allRoles.map((r) => [r.id, r.name])), [allRoles]);

  const alreadyAssigned = useMemo(
    () => new Set(staff.filter((s) => s.payRoleId === payRole.id).map((s) => s.id)),
    [staff, payRole.id],
  );

  const newSelections = useMemo(
    () => [...selected].filter((id) => !alreadyAssigned.has(id)),
    [selected, alreadyAssigned],
  );

  const branchOptions = useMemo(
    () => [{ value: '', label: 'All branches' }, ...branches.map((b) => ({ value: b.id, label: b.name }))],
    [branches],
  );

  const setFilter = useCallback(
    (key: string, value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) {
            next.set(key, value);
          } else {
            next.delete(key);
          }
          if (key !== 'page') next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const columns: CompactTableColumn<StaffRow>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        hideable: false,
        render: (row) => <span className="font-medium text-app-fg">{row.name}</span>,
      },
      {
        key: 'role',
        header: 'Role',
        render: (row) => <RoleBadge role={row.role} size="sm" />,
      },
      {
        key: 'payRole',
        header: 'Pay role',
        render: (row) => (
          <PayRoleStatusCell row={row} payRoleId={payRole.id} payRoleById={payRoleById} />
        ),
      },
    ],
    [payRole.id, payRoleById],
  );

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasActiveFilters = !!(filters.role || filters.branchId || filters.assignStatus || filters.search);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Assign: ${payRole.name}`}
        backTo="/hr/payroll/config/roles"
        mobileInlineActions
        description="Select staff members to assign this pay role."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Filters"
            triggerAriaLabel="Assign toolbar"
            filtersBadgeCount={[filters.role, filters.branchId, filters.assignStatus, filters.search].filter(Boolean).length}
            desktop={
              <div className="flex items-center gap-2">
                <PageSearchControl
                  value={filters.search ?? ''}
                  placeholder="Search by name"
                  title="Search staff"
                  onApply={(query) => setFilter('search', query)}
                />
                <FormSelect
                  label=""
                  name="role"
                  options={ROLE_FILTER_OPTIONS}
                  value={filters.role ?? ''}
                  onChange={(e) => setFilter('role', e.target.value)}
                  className="w-44"
                />
                {branches.length > 1 && (
                  <FormSelect
                    label=""
                    name="branchId"
                    options={branchOptions}
                    value={filters.branchId ?? ''}
                    onChange={(e) => setFilter('branchId', e.target.value)}
                    className="w-44"
                  />
                )}
                <FormSelect
                  label=""
                  name="assignStatus"
                  options={ASSIGN_STATUS_OPTIONS}
                  value={filters.assignStatus ?? ''}
                  onChange={(e) => setFilter('assignStatus', e.target.value)}
                  className="w-48"
                />
                <PageRefreshButton />
              </div>
            }
            sheet={() => (
              <div className="space-y-3">
                <PageSearchControl
                  value={filters.search ?? ''}
                  placeholder="Search by name"
                  title="Search staff"
                  onApply={(query) => setFilter('search', query)}
                />
                <FormSelect
                  label="System role"
                  name="role"
                  options={ROLE_FILTER_OPTIONS}
                  value={filters.role ?? ''}
                  onChange={(e) => setFilter('role', e.target.value)}
                />
                {branches.length > 1 && (
                  <FormSelect
                    label="Branch"
                    name="branchId"
                    options={branchOptions}
                    value={filters.branchId ?? ''}
                    onChange={(e) => setFilter('branchId', e.target.value)}
                  />
                )}
                <FormSelect
                  label="Assignment status"
                  name="assignStatus"
                  options={ASSIGN_STATUS_OPTIONS}
                  value={filters.assignStatus ?? ''}
                  onChange={(e) => setFilter('assignStatus', e.target.value)}
                />
              </div>
            )}
          />
        }
      />

      <OverviewStatStrip
        mobileGrid
        mobileGridCols={3}
        items={[
          { label: 'Total staff', value: total },
          {
            label: 'Selected',
            value: selected.size,
            valueClassName: selected.size > 0 ? 'text-brand-600 dark:text-brand-400' : 'text-app-fg',
          },
          {
            label: 'Already assigned',
            value: alreadyAssigned.size,
            valueClassName: 'text-success-600 dark:text-success-400',
          },
          {
            label: 'New to assign',
            value: newSelections.length,
            valueClassName:
              newSelections.length > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg',
          },
        ]}
      />

      {staff.length === 0 ? (
        <EmptyState
          title={hasActiveFilters ? 'No matching staff' : 'No staff found'}
          description={
            hasActiveFilters ? 'Try adjusting your filters.' : 'No active staff members available.'
          }
        />
      ) : (
        <>
          <CompactTable<StaffRow>
            columnVisibilityKey="hr.payroll.assign"
            columns={columns}
            rows={staff}
            rowKey={(r) => r.id}
            emptyTitle="No staff"
            emptyDescription=""
            selection={
              canWrite
                ? {
                    selectedIds: selected,
                    onToggle: (id, isSelected) => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (isSelected) next.add(id);
                        else next.delete(id);
                        return next;
                      });
                    },
                    onToggleAll: (selectAll) => {
                      if (selectAll) {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          for (const s of staff) next.add(s.id);
                          return next;
                        });
                      } else {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          for (const s of staff) next.delete(s.id);
                          return next;
                        });
                      }
                    },
                  }
                : undefined
            }
            renderMobileCard={(row, _i, helpers) => (
              <div className="rounded-lg border border-app-border bg-app-elevated p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    {helpers.rowSelection}
                    <div className="min-w-0">
                      <p className="font-medium text-app-fg text-sm truncate">{row.name}</p>
                      <div className="mt-1">
                        <RoleBadge role={row.role} size="sm" />
                      </div>
                    </div>
                  </div>
                  <PayRoleStatusCell row={row} payRoleId={payRole.id} payRoleById={payRoleById} />
                </div>
              </div>
            )}
          />

          {totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={(p) => setFilter('page', String(p))}
            />
          )}
        </>
      )}

      {canWrite && (
        <div className="border-t border-app-border pt-4">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={newSelections.length === 0}
              loading={fetcher.state === 'submitting'}
              loadingText="Assigning..."
              onClick={() => setShowAssignConfirm(true)}
            >
              Assign {newSelections.length} staff
            </Button>
            {newSelections.length > 0 && (
              <span className="text-xs text-app-fg-muted">
                {newSelections.length} new assignment{newSelections.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      )}

      <ConfirmActionModal
        open={showAssignConfirm}
        onClose={() => setShowAssignConfirm(false)}
        title="Assign pay role"
        description={
          <>
            Assign <strong>{payRole.name}</strong> to {newSelections.length} staff member
            {newSelections.length === 1 ? '' : 's'}?
          </>
        }
        details={
          <ul className="list-disc pl-4 space-y-1 text-sm">
            <li>Staff already on another pay role will be moved to this role</li>
            <li>Future payroll batches will use this role&apos;s rules for these staff</li>
          </ul>
        }
        confirmLabel={`Assign ${newSelections.length} staff`}
        variant="warning"
        loading={fetcher.state === 'submitting'}
        onConfirm={() => {
          fetcher.submit(
            {
              intent: 'bulkAssignPayRole',
              payRoleId: payRole.id,
              userIds: JSON.stringify(newSelections),
            },
            { method: 'post' },
          );
        }}
      />
    </div>
  );
}
