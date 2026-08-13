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
  /** Filter to a single user role (enum value, e.g. MEDIA_BUYER). */
  role: z.string().trim().max(40).optional(),
  /**
   * Show only staff who have at least one day this month marked with one of
   * these statuses (e.g. ['ABSENT'] → everyone with any absence). Omit = all staff.
   */
  statuses: z.array(attendanceStatusSchema).max(4).optional(),
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

/** Bulk-mark one day for many staff at once (HR). */
export const markAttendanceBulkSchema = z.object({
  staffIds: z.array(z.string().uuid()).min(1).max(500),
  attendanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  status: attendanceStatusSchema,
  remark: z.string().trim().max(500).optional(),
});
export type MarkAttendanceBulkInput = z.infer<typeof markAttendanceBulkSchema>;

/**
 * Mark an inclusive date RANGE for ONE staff member (HR). Used by "mark whole
 * month" — one call instead of N. `onlyBlank` skips days already marked.
 */
export const markAttendanceRangeSchema = z
  .object({
    staffId: z.string().uuid(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    status: attendanceStatusSchema,
    remark: z.string().trim().max(500).optional(),
    /** When true, only fill days with no existing record. */
    onlyBlank: z.boolean().optional(),
  })
  .refine((v) => v.startDate <= v.endDate, { message: 'startDate must be on or before endDate', path: ['endDate'] });
export type MarkAttendanceRangeInput = z.infer<typeof markAttendanceRangeSchema>;

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
