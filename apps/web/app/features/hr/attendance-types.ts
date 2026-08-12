/** Client mirror of the attendance.grid / attendance.summary API responses. */

/** Recorded statuses (what HR can mark + what the API stores). */
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'OFF_DUTY' | 'SICK';

/**
 * Display status for a grid/calendar cell. 'NONE' = no record for that day
 * (unmarked/blank) — the default. Unmarked days are NOT counted in the summary
 * or the attendance %, and never affect pay. HR must mark P/A/O/S explicitly.
 */
export type CellStatus = AttendanceStatus | 'NONE';

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
  status: CellStatus; // NONE = unmarked/blank
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

/** Short single-letter labels for the grid cells. NONE = blank. */
export const STATUS_LETTER: Record<CellStatus, string> = {
  PRESENT: 'P',
  ABSENT: 'A',
  OFF_DUTY: 'O',
  SICK: 'S',
  NONE: '',
};

export const STATUS_LABEL: Record<CellStatus, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  OFF_DUTY: 'Off duty',
  SICK: 'Sick leave',
  NONE: 'Not marked',
};

/** The statuses HR can assign in the mark UI (blank is cleared separately). */
export const MARK_CYCLE: AttendanceStatus[] = ['PRESENT', 'ABSENT', 'OFF_DUTY', 'SICK'];

/**
 * Attendance color theme — one source of truth for the HR grid cells and the
 * staff portal calendar. P green, A red, O amber, S blue, NONE = neutral blank.
 * Theme-aware (light + dark).
 */
export const STATUS_THEME: Record<
  CellStatus,
  { cell: string; dot: string; badgeVariant: 'success' | 'danger' | 'warning' | 'info' | 'neutral' }
> = {
  PRESENT: {
    cell: 'bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300',
    dot: 'bg-green-500',
    badgeVariant: 'success',
  },
  ABSENT: {
    cell: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
    dot: 'bg-red-500',
    badgeVariant: 'danger',
  },
  OFF_DUTY: {
    cell: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
    dot: 'bg-amber-500',
    badgeVariant: 'warning',
  },
  SICK: {
    cell: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
    dot: 'bg-blue-500',
    badgeVariant: 'info',
  },
  NONE: {
    // Blank/unmarked: an empty dashed box that clearly invites a click to mark.
    // Visible (not faint) so HR can see exactly which days still need marking.
    cell: 'bg-app-muted/40 text-transparent border-2 border-dashed border-app-border hover:border-brand-400',
    dot: 'bg-app-border',
    badgeVariant: 'neutral',
  },
};

/**
 * Weeks of a month, Monday-anchored. Each week is a 7-slot array (Mon→Sun);
 * slots outside the month are `null` so the grid renders full aligned rows.
 */
export function weeksOfMonth(year: number, month1: number): Array<Array<number | null>> {
  const daysInMonth = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  const weeks: Array<Array<number | null>> = [];
  let current: Array<number | null> = [];

  // Monday-index (0=Mon … 6=Sun) of the 1st.
  const firstDow = new Date(Date.UTC(year, month1 - 1, 1)).getUTCDay(); // 0=Sun
  const leadingBlanks = (firstDow + 6) % 7; // convert so Monday=0
  for (let i = 0; i < leadingBlanks; i++) current.push(null);

  for (let d = 1; d <= daysInMonth; d++) {
    current.push(d);
    if (current.length === 7) {
      weeks.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    while (current.length < 7) current.push(null);
    weeks.push(current);
  }
  return weeks;
}

export const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
