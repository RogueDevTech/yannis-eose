/** Client mirror of the attendance.grid / attendance.summary API responses. */

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'OFF_DUTY' | 'SICK';

export interface AttendanceSummaryCounts {
  present: number;
  absent: number;
  offDuty: number;
  sick: number;
  attendancePct: number;
}

export interface AttendanceGridRow {
  staffId: string;
  name: string;
  role: string;
  /** Only exception days are present; a missing day = PRESENT. Keyed YYYY-MM-DD. */
  exceptions: Record<string, { status: AttendanceStatus; remark: string | null }>;
  summary: AttendanceSummaryCounts;
  attendanceGated: boolean;
  baseAtRisk: boolean;
  deductionPercent: number;
}

export interface AttendanceGridData {
  month: string; // YYYY-MM
  days: number;
  staff: AttendanceGridRow[];
}

export interface AttendanceCalendarDay {
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  remark: string | null;
}

export interface AttendanceSummaryData {
  month: string;
  days: number;
  calendar: AttendanceCalendarDay[];
  summary: AttendanceSummaryCounts;
  eligibility: {
    gated: boolean;
    baseAtRisk: boolean;
    deductionPercent: number;
    reason: string | null;
  };
}

export interface AbsenceBand {
  minAbsences: number;
  deductionPercent: number;
}

/** A pay role row with its attendance config, for the band editor. */
export interface PayRoleConfigRow {
  id: string;
  name: string;
  attendanceConfig?: { enabled: boolean; bands: AbsenceBand[] } | null;
}

/** Short single-letter labels for the grid cells. */
export const STATUS_LETTER: Record<AttendanceStatus, string> = {
  PRESENT: 'P',
  ABSENT: 'A',
  OFF_DUTY: 'O',
  SICK: 'S',
};

export const STATUS_LABEL: Record<AttendanceStatus, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  OFF_DUTY: 'Off duty',
  SICK: 'Sick leave',
};

export const STATUS_CYCLE: AttendanceStatus[] = ['PRESENT', 'ABSENT', 'OFF_DUTY', 'SICK'];
