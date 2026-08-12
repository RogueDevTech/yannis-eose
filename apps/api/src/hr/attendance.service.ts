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
  type AttendanceSummaryInput,
  type SavePayRoleAttendanceConfigInput,
  type SetUserAttendanceOverrideInput,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { withActor } from '../common/db/with-actor';
import type { SessionUser } from '../common/decorators/current-user.decorator';

type Db = PostgresJsDatabase<typeof schema>;

/** Roles that may edit the master sheet + attendance config. */
const HR_MANAGE_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'HR_MANAGER']);

/** Inclusive [firstDay, lastDay] for a YYYY-MM month, as YYYY-MM-DD strings (WAT day keys). */
function monthBounds(month: string): { start: string; end: string; days: number } {
  const parts = month.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last day of this
  const mm = String(m).padStart(2, '0');
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(days).padStart(2, '0')}`, days };
}

@Injectable()
export class AttendanceService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  private assertCanManage(actor: SessionUser) {
    if (!HR_MANAGE_ROLES.has(actor.role)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only HR can edit attendance.',
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
        dateOfJoining: schema.users.dateOfJoining,
        exitDate: schema.users.exitDate,
        override: schema.users.attendanceAffectsPay,
      })
      .from(schema.users)
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
      let present = 0, absent = 0, off = 0, sick = 0;
      for (let d = 1; d <= days; d++) {
        const key = `${input.month}-${String(d).padStart(2, '0')}`;
        const cell = cells.get(key);
        const status = cell?.status ?? 'PRESENT';
        if (status === 'ABSENT') absent++;
        else if (status === 'OFF_DUTY') off++;
        else if (status === 'SICK') sick++;
        else present++;
      }
      // Attendance % — OFF counts present-equivalent (HR decision); ABSENT lowers it.
      const numerator = present + off + sick; // only absent hurts
      const pct = days > 0 ? Math.round((numerator / days) * 100) : 100;

      const roleCfg = s.payRoleId ? roleConfigById.get(s.payRoleId) ?? null : null;
      const enabled = resolveAttendanceEnabled(roleCfg?.enabled ?? false, s.override ?? null);
      const elig = enabled
        ? computeAttendanceEligibility({ absences: absent, config: { enabled: true, bands: roleCfg?.bands ?? [] } })
        : null;

      return {
        staffId: s.id,
        name: s.name,
        role: s.role,
        exceptions: Object.fromEntries(cells),
        summary: { present, absent, offDuty: off, sick, attendancePct: pct },
        attendanceGated: enabled,
        baseAtRisk: !!elig?.baseReduced,
        deductionPercent: elig?.deductionPercent ?? 0,
      };
    });

    return { month: input.month, days, staff: rows };
  }

  /** Upsert one staff/day cell. HR only. Actor-stamped + audited via history trigger. */
  async mark(input: MarkAttendanceInput, actor: SessionUser) {
    this.assertCanManage(actor);

    // Stamp branch/group from the staff member so the grid + summaries scope correctly.
    const [staff] = await this.db
      .select({ id: schema.users.id, primaryBranchId: schema.users.primaryBranchId })
      .from(schema.users)
      .where(eq(schema.users.id, input.staffId))
      .limit(1);
    if (!staff) throw new TRPCError({ code: 'NOT_FOUND', message: 'Staff not found.' });

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

  /** Monthly summary for one staff member (self-view or HR). */
  async summary(input: AttendanceSummaryInput, actor: SessionUser) {
    const staffId = input.staffId ?? actor.id;
    // Staff may only view their own; HR may view anyone.
    if (staffId !== actor.id && !HR_MANAGE_ROLES.has(actor.role)) {
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

    let present = 0, absent = 0, off = 0, sick = 0;
    const calendar: Array<{ date: string; status: string; remark: string | null }> = [];
    for (let d = 1; d <= days; d++) {
      const date = `${input.month}-${String(d).padStart(2, '0')}`;
      const rec = byDay.get(date);
      const status = rec?.status ?? 'PRESENT';
      if (status === 'ABSENT') absent++;
      else if (status === 'OFF_DUTY') off++;
      else if (status === 'SICK') sick++;
      else present++;
      calendar.push({ date, status, remark: rec?.remark ?? null });
    }

    // Base eligibility for this staff (role config + override).
    const [u] = await this.db
      .select({ payRoleId: schema.users.payRoleId, override: schema.users.attendanceAffectsPay })
      .from(schema.users)
      .where(eq(schema.users.id, staffId))
      .limit(1);
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
      calendar,
      summary: {
        present,
        absent,
        offDuty: off,
        sick,
        attendancePct: days > 0 ? Math.round(((present + off + sick) / days) * 100) : 100,
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
    return withActor(this.db, actor, async (tx) => {
      const res = await tx
        .update(schema.payrollPayRoles)
        .set({ attendanceConfig: input.config as AttendanceConfig, updatedAt: sql`now()` })
        .where(eq(schema.payrollPayRoles.id, input.payRoleId))
        .returning({ id: schema.payrollPayRoles.id });
      if (res.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pay role not found.' });
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
  exceptions: Record<string, { status: string; remark: string | null }>;
  summary: { present: number; absent: number; offDuty: number; sick: number; attendancePct: number };
  attendanceGated: boolean;
  baseAtRisk: boolean;
  deductionPercent: number;
}
