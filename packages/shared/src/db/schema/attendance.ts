import { uuid, pgTable, text, date, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { attendanceStatusEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';
import { branches } from './branches';
import { branchGroups } from './branch-groups';

/**
 * Table: attendance_records — one row per staff member per marked day (Track C).
 *
 * HR-driven master sheet: days default to PRESENT, so we ONLY persist exception
 * days (ABSENT / OFF_DUTY / SICK) and any explicit PRESENT override. A staff/day
 * with NO row is Present. This keeps a full month of an all-present workforce
 * cheap and makes "did HR deliberately mark this?" answerable.
 *
 * Only ABSENT feeds payroll eligibility (attendance-eligibility.ts). OFF_DUTY and
 * SICK are recorded for the sheet + staff transparency but never reduce pay.
 *
 * Every edit is audited via the system-versioned history twin
 * (attendance_records_history) + the actor stamp trigger — satisfying the
 * requirement that every attendance modification logs who/when/old→new.
 */
export const attendanceRecords = pgTable(
  'attendance_records',
  {
    id: uuidv7Pk(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => users.id),
    /** The calendar day this record covers (WAT day). */
    attendanceDate: date('attendance_date').notNull(),
    status: attendanceStatusEnum('status').notNull(),
    /** Optional free-text note HR attaches to an exception (e.g. "approved leave"). */
    remark: text('remark'),
    /**
     * Denormalised scope, stamped from the staff member at write time so the
     * grid + summaries scope the same way the rest of HR/payroll does
     * (servicing branch group). Nullable for staff without a branch/group.
     */
    branchId: uuid('branch_id').references(() => branches.id),
    groupId: uuid('group_id').references(() => branchGroups.id),
    /** Who set this cell (HR). Distinct from the trigger-stamped modified_by. */
    markedBy: uuid('marked_by').references(() => users.id),
    markedAt: timestamp('marked_at', { withTimezone: true }).defaultNow().notNull(),
    ...temporalColumns,
    ...timestampColumns,
  },
  (t) => ({
    // One record per staff per day — markCell UPSERTs on this.
    uqStaffDay: uniqueIndex('uq_attendance_staff_day').on(t.staffId, t.attendanceDate),
  }),
);
