import { PageHeader } from '~/components/ui/page-header';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';

export interface TeamAttendanceRow {
  staffId: string;
  staffName: string | null;
  staffRole: string | null;
  present: number;
  absent: number;
  offDuty: number;
  sick: number;
  inPayroll: boolean;
  payrollStatus: string;
}

interface TeamAttendancePageProps {
  rows: TeamAttendanceRow[];
  month: string;
}

function monthLabel(month: string): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return month;
  return d.toLocaleDateString('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Team attendance for a CS manager (doc §1): each supervised staff member's
 * monthly present/absent/sick/off totals + whether they're currently in payroll.
 * Read-only; scoped server-side to the manager's own squad.
 */
export function TeamAttendancePage({ rows, month }: TeamAttendancePageProps) {
  const columns: CompactTableColumn<TeamAttendanceRow>[] = [
    { key: 'name', header: 'Staff', render: (r) => r.staffName ?? 'Unknown' },
    { key: 'present', header: 'Present', align: 'right', render: (r) => r.present },
    { key: 'absent', header: 'Absent', align: 'right', render: (r) => r.absent },
    { key: 'sick', header: 'Sick', align: 'right', render: (r) => r.sick },
    { key: 'off', header: 'Off-duty', align: 'right', render: (r) => r.offDuty },
    {
      key: 'payroll',
      header: 'Payroll',
      render: (r) => (
        <StatusBadge
          status={r.inPayroll ? 'active' : r.payrollStatus === 'PENDING_APPROVAL' ? 'pending' : 'inactive'}
          label={
            r.inPayroll
              ? 'In payroll'
              : r.payrollStatus === 'PENDING_APPROVAL'
                ? 'Pending'
                : 'Not in payroll'
          }
          size="sm"
        />
      ),
    },
  ];

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        title="Team attendance"
        description={`Attendance and payroll status for your team, ${monthLabel(month)}.`}
        backTo="/admin"
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No team members"
          description="You have no staff assigned to your team, or none for this month."
        />
      ) : (
        <CompactTable rows={rows} columns={columns} rowKey={(r) => r.staffId} />
      )}
    </div>
  );
}
