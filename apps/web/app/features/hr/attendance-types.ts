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
  /** Party id: a users.id for staff, or a payroll_contractors.id when isContractor. */
  staffId: string;
  /** True when this row is a contractor (marked via contractorId, not staffId). */
  isContractor?: boolean;
  name: string;
  role: string;
  branchId: string | null;
  branchName: string | null;
  /** Only exception days are present; a missing day = PRESENT. Keyed YYYY-MM-DD. */
  exceptions: Record<string, { status: AttendanceStatus; remark: string | null; markedAt: string | null }>;
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
  staffId: string;
  staffName: string | null;
  staffRole: string | null;
  /** When true, this staff member is not tracked for attendance (hide the card). */
  excluded?: boolean;
  /** Company work days (0=Sun..6=Sat); non-work days are hidden on the calendar. */
  workDays: number[];
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
    // Bright near-white dashed border for maximum visibility, and it doesn't clash
    // with any status colour (green/red/amber/blue). Darker on light mode so it
    // stays visible there too.
    cell: 'bg-app-muted/40 text-transparent border-2 border-dashed border-gray-500 hover:border-gray-700 dark:border-white/70 dark:hover:border-white',
    dot: 'bg-app-border',
    badgeVariant: 'neutral',
  },
};

/**
 * One cell in the weekly grid. `date` is the real YYYY-MM-DD; `day` its
 * day-of-month; `inMonth` false for leading/trailing days that belong to the
 * adjacent month (shown greyed, non-interactive) so every week is a full aligned
 * Mon→Sun row that always displays a date.
 */
export interface WeekCell {
  date: string;
  day: number;
  inMonth: boolean;
}

/** Weeks of a month, Monday-anchored, padded with real adjacent-month dates. */
export function weeksOfMonth(year: number, month1: number): WeekCell[][] {
  const daysInMonth = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  // Monday-index (0=Mon … 6=Sun) of the 1st.
  const firstDow = new Date(Date.UTC(year, month1 - 1, 1)).getUTCDay();
  const leadingBlanks = (firstDow + 6) % 7;

  const cellFor = (offset: number): WeekCell => {
    // offset is days from the 1st of month1 (can be negative for prev-month).
    const d = new Date(Date.UTC(year, month1 - 1, 1 + offset));
    const date = d.toISOString().slice(0, 10);
    return { date, day: d.getUTCDate(), inMonth: d.getUTCMonth() === month1 - 1 };
  };

  const weeks: WeekCell[][] = [];
  let current: WeekCell[] = [];
  // Start from the Monday that begins the first week (may be in the prev month).
  for (let offset = -leadingBlanks; ; offset++) {
    current.push(cellFor(offset));
    if (current.length === 7) {
      weeks.push(current);
      current = [];
    }
    // Stop once we've placed the last day of the month AND completed its week.
    if (offset >= daysInMonth - 1 && current.length === 0) break;
  }
  return weeks;
}

export const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** getUTCDay() (0=Sun..6=Sat) for each Mon-first column index 0..6. */
const MON_FIRST_WEEKDAY = [1, 2, 3, 4, 5, 6, 0];

/**
 * Work-day calendar layout, so per-staff calendars show ONLY the configured
 * work days (e.g. Mon–Fri) — non-work days are dropped as columns entirely.
 *
 * Given the company `workDays` (getUTCDay values 0..6), returns the Mon-first
 * ordered list of work weekdays + their short labels, and a helper to map a
 * date's weekday to its column index (or -1 when it's a non-work day).
 */
export function workDayLayout(workDays: number[] | null | undefined): {
  labels: string[];
  /** getUTCDay values of the work columns, Mon-first. */
  weekdays: number[];
  cols: number;
  /** Column index (0-based) of a getUTCDay value, or -1 if it isn't a work day. */
  colOf: (utcDay: number) => number;
} {
  const set = new Set(workDays && workDays.length ? workDays : [1, 2, 3, 4, 5]);
  const weekdays: number[] = [];
  const labels: string[] = [];
  MON_FIRST_WEEKDAY.forEach((wd, i) => {
    if (set.has(wd)) {
      weekdays.push(wd);
      labels.push(WEEKDAY_HEADERS[i]!);
    }
  });
  const colByWeekday = new Map(weekdays.map((wd, idx) => [wd, idx]));
  return {
    labels,
    weekdays,
    cols: weekdays.length,
    colOf: (utcDay: number) => colByWeekday.get(utcDay) ?? -1,
  };
}

/**
 * Maps a Monday-anchored column slot (0=Mon … 6=Sun) to the JS getUTCDay weekday
 * number (0=Sun … 6=Sat), matching `AttendancePolicy.workDays`.
 */
export const WEEKDAY_INDEX = [1, 2, 3, 4, 5, 6, 0];

/** Whether a YYYY-MM-DD date is a work day under the given workDays (0=Sun..6=Sat). */
export function isWorkDayDate(date: string, workDays: number[]): boolean {
  const parts = date.split('-');
  const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  return workDays.includes(d.getUTCDay());
}
