import { z } from 'zod';

/** The four daily attendance statuses. Only ABSENT affects pay. */
export const attendanceStatusSchema = z.enum(['PRESENT', 'ABSENT', 'OFF_DUTY', 'SICK']);
export type AttendanceStatusInput = z.infer<typeof attendanceStatusSchema>;

/** One configured absence band (per pay role). */
export const absenceBandSchema = z.object({
  minAbsences: z.number().int().min(0).max(31),
  deductionPercent: z.number().min(0).max(100),
});

/** Per-pay-role attendance config payload (validated before it lands in JSONB). */
export const attendanceConfigSchema = z.object({
  enabled: z.boolean(),
  bands: z.array(absenceBandSchema).max(10),
});
export type AttendanceConfigInput = z.infer<typeof attendanceConfigSchema>;

/** Month key `YYYY-MM` for grid + summary reads. */
const monthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'Month must be YYYY-MM');

/** Read the master grid for a month (HR). Branch/group optional narrowing. */
export const attendanceGridSchema = z.object({
  month: monthSchema,
  branchId: z.string().uuid().optional(),
  search: z.string().trim().max(120).optional(),
});
export type AttendanceGridInput = z.infer<typeof attendanceGridSchema>;

/** Mark (upsert) one staff/day cell. HR only. */
export const markAttendanceSchema = z.object({
  staffId: z.string().uuid(),
  attendanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  status: attendanceStatusSchema,
  remark: z.string().trim().max(500).optional(),
});
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;

/** Monthly summary for one staff member (staff self-view or HR). */
export const attendanceSummarySchema = z.object({
  month: monthSchema,
  staffId: z.string().uuid().optional(), // omitted → self
});
export type AttendanceSummaryInput = z.infer<typeof attendanceSummarySchema>;

/** Save a pay role's attendance config. */
export const savePayRoleAttendanceConfigSchema = z.object({
  payRoleId: z.string().uuid(),
  config: attendanceConfigSchema,
});
export type SavePayRoleAttendanceConfigInput = z.infer<typeof savePayRoleAttendanceConfigSchema>;

/** Set a user's per-user attendance override (null = inherit role). */
export const setUserAttendanceOverrideSchema = z.object({
  staffId: z.string().uuid(),
  attendanceAffectsPay: z.boolean().nullable(),
});
export type SetUserAttendanceOverrideInput = z.infer<typeof setUserAttendanceOverrideSchema>;
