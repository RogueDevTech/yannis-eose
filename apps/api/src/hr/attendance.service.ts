import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { uuidv7 } from 'uuidv7';
import {
  db as schema,
  computeAttendanceEligibility,
  resolveAttendanceEnabled,
  type AttendanceConfig,
  type AttendanceGridInput,
  type MarkAttendanceInput,
  type MarkAttendanceBulkInput,
  type MarkAttendanceRangeInput,
  type AttendanceSummaryInput,
  type SavePayRoleAttendanceConfigInput,
  type SetUserAttendanceOverrideInput,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { withActor } from '../common/db/with-actor';
import { isAdminLevel } from '../common/authz';
import { nigeriaToday } from '../common/utils/date-range';
import type { SessionUser } from '../common/decorators/current-user.decorator';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Whether the actor may edit attendance. Permission-code first (never a raw role
 * set — that would ignore RBAC grants and lock out custom role templates); admins
 * bypass via isAdminLevel(), matching the rest of the platform.
 */
function canManageAttendance(actor: SessionUser): boolean {
  if (isAdminLevel(actor)) return true;
  const codes = actor.permissions ?? [];
  return codes.includes('attendance.manage') || codes.includes('hr.write');
}

/** Whether the actor may VIEW any staff's attendance (master sheet / others). */
function canReadAllAttendance(actor: SessionUser): boolean {
  if (isAdminLevel(actor)) return true;
  const codes = actor.permissions ?? [];
  return codes.includes('attendance.read') || codes.includes('attendance.manage') || codes.includes('hr.read');
}

/** Inclusive [firstDay, lastDay] for a YYYY-MM month, as YYYY-MM-DD strings (WAT day keys). */
function monthBounds(month: string): { start: string; end: string; days: number } {
  const parts = month.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last day of this
  const mm = String(m).padStart(2, '0');
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(days).padStart(2, '0')}`, days };
}

/**
 * Reject a mark date that is in the future (past today, WAT) or outside a staff
 * member's employment window. Lexical YYYY-MM-DD comparison (valid, zero-padded).
 * Throws a TRPCError; callers pass the staff's joining/exit (may be null).
 */
function assertMarkableDate(
  date: string,
  joining: string | null | undefined,
  exit: string | null | undefined,
): void {
  const today = nigeriaToday();
  if (date > today) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot mark attendance for a future date.' });
  }
  if (joining && date < joining.slice(0, 10)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Date is before the staff member joined.' });
  }
  if (exit && date > exit.slice(0, 10)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Date is after the staff member exited.' });
  }
}


@Injectable()
export class AttendanceService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  private assertCanManage(actor: SessionUser) {
    if (!canManageAttendance(actor)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to edit attendance.',
      });
    }
  }

  /**
   * Master grid for a month: one row per payroll-eligible staff member, with the
   * exception days they've been marked (missing day = Present). Scoped to the
   * actor's effective branches.
   */
  async grid(input: AttendanceGridInput, actor: SessionUser, effectiveBranchIds?: string[] | null) {
    this.assertCanManage(actor);
    const { start, end, days } = monthBounds(input.month);

    // Enumerate the SAME population payroll pays: ACTIVE staff with a comp basis,
    // scoped to the actor's effective branches (or the requested branch).
    const branchScope = input.branchId
      ? [input.branchId]
      : (effectiveBranchIds ?? []).filter(Boolean);

    const staffConds = [
      eq(schema.users.status, 'ACTIVE'),
      sql`(${schema.users.payRoleId} IS NOT NULL OR ${schema.users.flatMonthlyAmount} IS NOT NULL)`,
    ];
    if (branchScope.length) {
      staffConds.push(inArray(schema.users.primaryBranchId, branchScope as string[]));
    }
    if (input.role) {
      staffConds.push(eq(schema.users.role, input.role as typeof schema.users.role.enumValues[number]));
    }
    if (input.search) {
      staffConds.push(sql`${schema.users.name} ILIKE ${'%' + input.search + '%'}`);
    }

    const staff = await this.db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        role: schema.users.role,
        payRoleId: schema.users.payRoleId,
        primaryBranchId: schema.users.primaryBranchId,
        branchName: schema.branches.name,
        dateOfJoining: schema.users.dateOfJoining,
        exitDate: schema.users.exitDate,
        override: schema.users.attendanceAffectsPay,
      })
      .from(schema.users)
      .leftJoin(schema.branches, eq(schema.branches.id, schema.users.primaryBranchId))
      .where(and(...staffConds))
      .orderBy(asc(schema.users.name));

    if (staff.length === 0) {
      return { month: input.month, days, staff: [] as GridRow[] };
    }
    const staffIds = staff.map((s) => s.id);

    // Exception records for the month (present days are implicit).
    const records = await this.db
      .select({
        staffId: schema.attendanceRecords.staffId,
        attendanceDate: schema.attendanceRecords.attendanceDate,
        status: schema.attendanceRecords.status,
        remark: schema.attendanceRecords.remark,
      })
      .from(schema.attendanceRecords)
      .where(
        and(
          inArray(schema.attendanceRecords.staffId, staffIds),
          gte(schema.attendanceRecords.attendanceDate, start),
          lte(schema.attendanceRecords.attendanceDate, end),
        ),
      );

    const byStaff = new Map<string, Map<string, { status: string; remark: string | null }>>();
    for (const r of records) {
      const day = String(r.attendanceDate).slice(0, 10);
      if (!byStaff.has(r.staffId)) byStaff.set(r.staffId, new Map());
      byStaff.get(r.staffId)!.set(day, { status: r.status, remark: r.remark });
    }

    // Role attendance configs, for the at-risk flag.
    const payRoleIds = [...new Set(staff.map((s) => s.payRoleId).filter(Boolean))] as string[];
    const roleConfigById = new Map<string, AttendanceConfig>();
    if (payRoleIds.length) {
      const roles = await this.db
        .select({ id: schema.payrollPayRoles.id, cfg: schema.payrollPayRoles.attendanceConfig })
        .from(schema.payrollPayRoles)
        .where(inArray(schema.payrollPayRoles.id, payRoleIds));
      for (const r of roles) roleConfigById.set(r.id, (r.cfg as AttendanceConfig) ?? { enabled: false, bands: [] });
    }

    const rows: GridRow[] = staff.map((s) => {
      const cells = byStaff.get(s.id) ?? new Map();
      // Default-Unchecked model: ONLY marked days count. An unmarked day is blank
      // (neither present nor absent) and is excluded from counts + the %.
      let present = 0, absent = 0, off = 0, sick = 0;
      for (const cell of cells.values()) {
        if (cell.status === 'ABSENT') absent++;
        else if (cell.status === 'OFF_DUTY') off++;
        else if (cell.status === 'SICK') sick++;
        else if (cell.status === 'PRESENT') present++;
      }
      // Attendance % over MARKED days only — OFF/SICK/PRESENT count toward it,
      // only ABSENT lowers it. Blank (unmarked) days are not in the denominator.
      const marked = present + absent + off + sick;
      const numerator = present + off + sick;
      const pct = marked > 0 ? Math.round((numerator / marked) * 100) : 100;

      const roleCfg = s.payRoleId ? roleConfigById.get(s.payRoleId) ?? null : null;
      const enabled = resolveAttendanceEnabled(roleCfg?.enabled ?? false, s.override ?? null);
      const elig = enabled
        ? computeAttendanceEligibility({ absences: absent, config: { enabled: true, bands: roleCfg?.bands ?? [] } })
        : null;

      return {
        staffId: s.id,
        name: s.name,
        role: s.role,
        branchId: s.primaryBranchId ?? null,
        branchName: s.branchName ?? null,
        exceptions: Object.fromEntries(cells),
        summary: { present, absent, offDuty: off, sick, attendancePct: pct },
        attendanceGated: enabled,
        baseAtRisk: !!elig?.baseReduced,
        deductionPercent: elig?.deductionPercent ?? 0,
      };
    });

    // Status filter: keep only staff with >= 1 day marked with a requested status.
    const wanted = input.statuses && input.statuses.length ? new Set(input.statuses) : null;
    const filtered = wanted
      ? rows.filter((r) => Object.values(r.exceptions).some((c) => wanted.has(c.status as never)))
      : rows;

    return { month: input.month, days, staff: filtered };
  }

  /** Upsert one staff/day cell. HR only. Actor-stamped + audited via history trigger. */
  async mark(input: MarkAttendanceInput, actor: SessionUser) {
    this.assertCanManage(actor);

    // Stamp branch/group from the staff member so the grid + summaries scope correctly.
    const [staff] = await this.db
      .select({
        id: schema.users.id,
        primaryBranchId: schema.users.primaryBranchId,
        dateOfJoining: schema.users.dateOfJoining,
        exitDate: schema.users.exitDate,
      })
      .from(schema.users)
      .where(eq(schema.users.id, input.staffId))
      .limit(1);
    if (!staff) throw new TRPCError({ code: 'NOT_FOUND', message: 'Staff not found.' });
    assertMarkableDate(input.attendanceDate, staff.dateOfJoining, staff.exitDate);

    let branchId: string | null = staff.primaryBranchId ?? null;
    let groupId: string | null = null;
    if (branchId) {
      const [b] = await this.db
        .select({ groupId: schema.branches.groupId })
        .from(schema.branches)
        .where(eq(schema.branches.id, branchId))
        .limit(1);
      groupId = b?.groupId ?? null;
    }

    return withActor(this.db, actor, async (tx) => {
      await tx
        .insert(schema.attendanceRecords)
        .values({
          id: uuidv7(),
          staffId: input.staffId,
          attendanceDate: input.attendanceDate,
          status: input.status,
          remark: input.remark ?? null,
          branchId,
          groupId,
          markedBy: actor.id,
        })
        .onConflictDoUpdate({
          target: [schema.attendanceRecords.staffId, schema.attendanceRecords.attendanceDate],
          set: {
            status: input.status,
            remark: input.remark ?? null,
            markedBy: actor.id,
            markedAt: sql`now()`,
            updatedAt: sql`now()`,
          },
        });
      return { success: true };
    });
  }

  /** Bulk-mark one day for many staff (HR). One tx; each row upserted + audited. */
  async markBulk(input: MarkAttendanceBulkInput, actor: SessionUser) {
    this.assertCanManage(actor);
    const ids = [...new Set(input.staffIds)];

    // A future date is invalid for everyone — reject up front.
    if (input.attendanceDate > nigeriaToday()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot mark attendance for a future date.' });
    }

    // Resolve branch + group + employment window for every staff member in one query.
    const staffRows = await this.db
      .select({
        id: schema.users.id,
        branchId: schema.branches.id,
        groupId: schema.branches.groupId,
        dateOfJoining: schema.users.dateOfJoining,
        exitDate: schema.users.exitDate,
      })
      .from(schema.users)
      .leftJoin(schema.branches, eq(schema.branches.id, schema.users.primaryBranchId))
      .where(inArray(schema.users.id, ids));
    const scopeById = new Map(
      staffRows.map((r) => [r.id, { branchId: r.branchId, groupId: r.groupId, joining: r.dateOfJoining, exit: r.exitDate }]),
    );

    let count = 0;
    return withActor(this.db, actor, async (tx) => {
      for (const staffId of ids) {
        const scope = scopeById.get(staffId);
        if (!scope) continue; // skip unknown ids rather than fail the whole batch
        // Skip staff for whom the day is outside their employment window.
        if (scope.joining && input.attendanceDate < scope.joining.slice(0, 10)) continue;
        if (scope.exit && input.attendanceDate > scope.exit.slice(0, 10)) continue;
        count++;
        await tx
          .insert(schema.attendanceRecords)
          .values({
            id: uuidv7(),
            staffId,
            attendanceDate: input.attendanceDate,
            status: input.status,
            remark: input.remark ?? null,
            branchId: scope.branchId ?? null,
            groupId: scope.groupId ?? null,
            markedBy: actor.id,
          })
          .onConflictDoUpdate({
            target: [schema.attendanceRecords.staffId, schema.attendanceRecords.attendanceDate],
            set: {
              status: input.status,
              remark: input.remark ?? null,
              markedBy: actor.id,
              markedAt: sql`now()`,
              updatedAt: sql`now()`,
            },
          });
      }
      return { success: true, count };
    });
  }

  /**
   * Mark an inclusive date range for ONE staff member in a single tx (HR).
   * Powers "mark whole month". Clamps the range to [joining, min(exit, today)]
   * and, when `onlyBlank`, skips days that already have a record.
   */
  async markRange(input: MarkAttendanceRangeInput, actor: SessionUser) {
    this.assertCanManage(actor);

    const [staff] = await this.db
      .select({
        id: schema.users.id,
        primaryBranchId: schema.users.primaryBranchId,
        dateOfJoining: schema.users.dateOfJoining,
        exitDate: schema.users.exitDate,
      })
      .from(schema.users)
      .where(eq(schema.users.id, input.staffId))
      .limit(1);
    if (!staff) throw new TRPCError({ code: 'NOT_FOUND', message: 'Staff not found.' });

    // Clamp: never mark the future or outside employment.
    const today = nigeriaToday();
    const lowerBound = staff.dateOfJoining ? staff.dateOfJoining.slice(0, 10) : input.startDate;
    const upperCandidates = [input.endDate, today];
    if (staff.exitDate) upperCandidates.push(staff.exitDate.slice(0, 10));
    const start = input.startDate > lowerBound ? input.startDate : lowerBound;
    const end = upperCandidates.reduce((a, b) => (b < a ? b : a));
    if (start > end) return { success: true, count: 0 };

    let branchId: string | null = staff.primaryBranchId ?? null;
    let groupId: string | null = null;
    if (branchId) {
      const [b] = await this.db
        .select({ groupId: schema.branches.groupId })
        .from(schema.branches)
        .where(eq(schema.branches.id, branchId))
        .limit(1);
      groupId = b?.groupId ?? null;
    }

    // Enumerate the day strings in [start, end].
    const dates: string[] = [];
    {
      const s = new Date(`${start}T00:00:00Z`);
      const e = new Date(`${end}T00:00:00Z`);
      for (let t = s.getTime(); t <= e.getTime(); t += 86_400_000) {
        dates.push(new Date(t).toISOString().slice(0, 10));
      }
    }

    // When onlyBlank, drop days that already have a record.
    let targetDates = dates;
    if (input.onlyBlank) {
      const existing = await this.db
        .select({ d: schema.attendanceRecords.attendanceDate })
        .from(schema.attendanceRecords)
        .where(
          and(
            eq(schema.attendanceRecords.staffId, input.staffId),
            gte(schema.attendanceRecords.attendanceDate, start),
            lte(schema.attendanceRecords.attendanceDate, end),
          ),
        );
      const have = new Set(existing.map((r) => String(r.d).slice(0, 10)));
      targetDates = dates.filter((d) => !have.has(d));
    }

    if (targetDates.length === 0) return { success: true, count: 0 };

    return withActor(this.db, actor, async (tx) => {
      for (const attendanceDate of targetDates) {
        await tx
          .insert(schema.attendanceRecords)
          .values({
            id: uuidv7(),
            staffId: input.staffId,
            attendanceDate,
            status: input.status,
            remark: input.remark ?? null,
            branchId,
            groupId,
            markedBy: actor.id,
          })
          .onConflictDoUpdate({
            target: [schema.attendanceRecords.staffId, schema.attendanceRecords.attendanceDate],
            set: {
              status: input.status,
              remark: input.remark ?? null,
              markedBy: actor.id,
              markedAt: sql`now()`,
              updatedAt: sql`now()`,
            },
          });
      }
      return { success: true, count: targetDates.length };
    });
  }

  /** Monthly summary for one staff member (self-view or HR). */
  async summary(input: AttendanceSummaryInput, actor: SessionUser) {
    const staffId = input.staffId ?? actor.id;
    // Staff may only view their own; HR/admins may view anyone.
    if (staffId !== actor.id && !canReadAllAttendance(actor)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only view your own attendance.' });
    }
    const { start, end, days } = monthBounds(input.month);

    const records = await this.db
      .select({
        attendanceDate: schema.attendanceRecords.attendanceDate,
        status: schema.attendanceRecords.status,
        remark: schema.attendanceRecords.remark,
      })
      .from(schema.attendanceRecords)
      .where(
        and(
          eq(schema.attendanceRecords.staffId, staffId),
          gte(schema.attendanceRecords.attendanceDate, start),
          lte(schema.attendanceRecords.attendanceDate, end),
        ),
      );
    const byDay = new Map(records.map((r) => [String(r.attendanceDate).slice(0, 10), r]));

    // Staff config + employment window (needed for countable-day tallying).
    const [u] = await this.db
      .select({
        name: schema.users.name,
        role: schema.users.role,
        payRoleId: schema.users.payRoleId,
        override: schema.users.attendanceAffectsPay,
        dateOfJoining: schema.users.dateOfJoining,
        exitDate: schema.users.exitDate,
      })
      .from(schema.users)
      .where(eq(schema.users.id, staffId))
      .limit(1);

    let present = 0, absent = 0, off = 0, sick = 0;
    const calendar: Array<{ date: string; status: string; remark: string | null }> = [];
    for (let d = 1; d <= days; d++) {
      const date = `${input.month}-${String(d).padStart(2, '0')}`;
      const rec = byDay.get(date);
      // Default-Unchecked: unmarked days are 'NONE' (blank) and don't count.
      const status = rec?.status ?? 'NONE';
      if (rec) {
        if (status === 'ABSENT') absent++;
        else if (status === 'OFF_DUTY') off++;
        else if (status === 'SICK') sick++;
        else if (status === 'PRESENT') present++;
      }
      calendar.push({ date, status, remark: rec?.remark ?? null });
    }

    // Base eligibility for this staff (role config + override).
    let roleCfg: AttendanceConfig | null = null;
    if (u?.payRoleId) {
      const [r] = await this.db
        .select({ cfg: schema.payrollPayRoles.attendanceConfig })
        .from(schema.payrollPayRoles)
        .where(eq(schema.payrollPayRoles.id, u.payRoleId))
        .limit(1);
      roleCfg = (r?.cfg as AttendanceConfig) ?? null;
    }
    const enabled = resolveAttendanceEnabled(roleCfg?.enabled ?? false, u?.override ?? null);
    const elig = enabled
      ? computeAttendanceEligibility({ absences: absent, config: { enabled: true, bands: roleCfg?.bands ?? [] } })
      : null;

    return {
      month: input.month,
      days,
      staffId,
      staffName: u?.name ?? null,
      staffRole: u?.role ?? null,
      calendar,
      summary: {
        present,
        absent,
        offDuty: off,
        sick,
        attendancePct:
          present + absent + off + sick > 0
            ? Math.round(((present + off + sick) / (present + absent + off + sick)) * 100)
            : 100,
      },
      eligibility: {
        gated: enabled,
        baseAtRisk: !!elig?.baseReduced,
        deductionPercent: elig?.deductionPercent ?? 0,
        reason: elig?.reason ?? null,
      },
    };
  }

  /** Save a pay role's attendance config (bands + on/off). HR only. Audited. */
  async savePayRoleConfig(input: SavePayRoleAttendanceConfigInput, actor: SessionUser) {
    this.assertCanManage(actor);
    // Company isolation: a pay role belongs to a company (group). Non-admins may
    // only touch roles in their active company; admins are unscoped. Without this,
    // an HR manager in company A could rewrite company B's pay rules by id.
    const groupId = actor.activeGroupId ?? null;
    const scopeByGroup = !isAdminLevel(actor);
    if (scopeByGroup && !groupId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Select a company before editing attendance rules.' });
    }
    return withActor(this.db, actor, async (tx) => {
      const conds = [eq(schema.payrollPayRoles.id, input.payRoleId)];
      if (scopeByGroup && groupId) conds.push(eq(schema.payrollPayRoles.groupId, groupId));
      const res = await tx
        .update(schema.payrollPayRoles)
        .set({ attendanceConfig: input.config as AttendanceConfig, updatedAt: sql`now()` })
        .where(and(...conds))
        .returning({ id: schema.payrollPayRoles.id });
      if (res.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pay role not found in your company.' });
      return { success: true };
    });
  }

  /** Set a user's per-user attendance override (null = inherit role). HR only. Audited. */
  async setUserOverride(input: SetUserAttendanceOverrideInput, actor: SessionUser) {
    this.assertCanManage(actor);
    return withActor(this.db, actor, async (tx) => {
      const res = await tx
        .update(schema.users)
        .set({ attendanceAffectsPay: input.attendanceAffectsPay, updatedAt: sql`now()` })
        .where(eq(schema.users.id, input.staffId))
        .returning({ id: schema.users.id });
      if (res.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Staff not found.' });
      return { success: true };
    });
  }
}

interface GridRow {
  staffId: string;
  name: string;
  role: string;
  branchId: string | null;
  branchName: string | null;
  exceptions: Record<string, { status: string; remark: string | null }>;
  summary: { present: number; absent: number; offDuty: number; sick: number; attendancePct: number };
  attendanceGated: boolean;
  baseAtRisk: boolean;
  deductionPercent: number;
}
