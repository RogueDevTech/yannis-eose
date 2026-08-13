import {
  attendanceGridSchema,
  markAttendanceSchema,
  markAttendanceBulkSchema,
  markAttendanceRangeSchema,
  attendanceSummarySchema,
  savePayRoleAttendanceConfigSchema,
  setUserAttendanceOverrideSchema,
  attendancePolicySchema,
  setUserAttendanceExcludedSchema,
  setUsersAttendanceExcludedBulkSchema,
} from '@yannis/shared';
import { router, authedProcedure, permissionProcedure } from '../trpc';
import { AttendanceService } from '../../hr/attendance.service';

let attendanceServiceInstance: AttendanceService | null = null;
export function setAttendanceService(service: AttendanceService) {
  attendanceServiceInstance = service;
}
function getAttendanceService(): AttendanceService {
  if (!attendanceServiceInstance) {
    throw new Error('AttendanceService not initialized. Call setAttendanceService() first.');
  }
  return attendanceServiceInstance;
}

export const attendanceRouter = router({
  /** Master grid for a month (HR). */
  grid: permissionProcedure('attendance.read', 'hr.read')
    .input(attendanceGridSchema)
    .query(async ({ input, ctx }) => {
      return getAttendanceService().grid(input, ctx.user, ctx.effectiveBranchIds);
    }),

  /** Mark (upsert) one staff/day cell (HR). */
  mark: permissionProcedure('attendance.manage', 'hr.write')
    .input(markAttendanceSchema)
    .mutation(async ({ input, ctx }) => {
      return getAttendanceService().mark(input, ctx.user, ctx.effectiveBranchIds);
    }),

  /** Bulk-mark one day for many staff (HR). */
  markBulk: permissionProcedure('attendance.manage', 'hr.write')
    .input(markAttendanceBulkSchema)
    .mutation(async ({ input, ctx }) => {
      return getAttendanceService().markBulk(input, ctx.user, ctx.effectiveBranchIds);
    }),

  /** Mark a date range for one staff member in one call (HR). */
  markRange: permissionProcedure('attendance.manage', 'hr.write')
    .input(markAttendanceRangeSchema)
    .mutation(async ({ input, ctx }) => {
      return getAttendanceService().markRange(input, ctx.user, ctx.effectiveBranchIds);
    }),

  /** Monthly summary — self (any authed user) or, for HR, any staff member. */
  summary: authedProcedure
    .input(attendanceSummarySchema)
    .query(async ({ input, ctx }) => {
      return getAttendanceService().summary(input, ctx.user, ctx.effectiveBranchIds);
    }),

  /** Save a pay role's attendance config (bands + on/off). */
  savePayRoleConfig: permissionProcedure('attendance.manage', 'hr.write')
    .input(savePayRoleAttendanceConfigSchema)
    .mutation(async ({ input, ctx }) => {
      return getAttendanceService().savePayRoleConfig(input, ctx.user);
    }),

  /** Set a user's per-user attendance override (null = inherit role). */
  setUserOverride: permissionProcedure('attendance.manage', 'hr.write')
    .input(setUserAttendanceOverrideSchema)
    .mutation(async ({ input, ctx }) => {
      return getAttendanceService().setUserOverride(input, ctx.user, ctx.effectiveBranchIds);
    }),

  /** Read the global attendance policy (work days + strict rules) for the company. */
  getPolicy: permissionProcedure('attendance.read', 'hr.read')
    .query(async ({ ctx }) => {
      return getAttendanceService().getPolicy(ctx.user);
    }),

  /** Save the global attendance policy. HR only. */
  savePolicy: permissionProcedure('attendance.manage', 'hr.write')
    .input(attendancePolicySchema)
    .mutation(async ({ input, ctx }) => {
      return getAttendanceService().savePolicy(input, ctx.user);
    }),

  /** List staff with their attendance-excluded flag (config exclude picker). */
  listExcludableStaff: permissionProcedure('attendance.manage', 'hr.write')
    .query(async ({ ctx }) => {
      return getAttendanceService().listExcludableStaff(ctx.user, ctx.effectiveBranchIds);
    }),

  /** Exclude/include a staff member from attendance tracking. HR only. */
  setUserExcluded: permissionProcedure('attendance.manage', 'hr.write')
    .input(setUserAttendanceExcludedSchema)
    .mutation(async ({ input, ctx }) => {
      return getAttendanceService().setUserExcluded(input, ctx.user, ctx.effectiveBranchIds);
    }),

  /** Bulk-reconcile attendance exclusion (config page Save). HR only. */
  setUsersExcludedBulk: permissionProcedure('attendance.manage', 'hr.write')
    .input(setUsersAttendanceExcludedBulkSchema)
    .mutation(async ({ input, ctx }) => {
      return getAttendanceService().setUsersExcludedBulk(input, ctx.user, ctx.effectiveBranchIds);
    }),
});
