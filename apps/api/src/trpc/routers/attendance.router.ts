import {
  attendanceGridSchema,
  markAttendanceSchema,
  attendanceSummarySchema,
  savePayRoleAttendanceConfigSchema,
  setUserAttendanceOverrideSchema,
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
      return getAttendanceService().mark(input, ctx.user);
    }),

  /** Monthly summary — self (any authed user) or, for HR, any staff member. */
  summary: authedProcedure
    .input(attendanceSummarySchema)
    .query(async ({ input, ctx }) => {
      return getAttendanceService().summary(input, ctx.user);
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
      return getAttendanceService().setUserOverride(input, ctx.user);
    }),
});
