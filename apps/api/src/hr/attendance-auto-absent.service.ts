import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AttendanceService } from './attendance.service';

/**
 * Auto-absent scheduler.
 *
 * Runs hourly. For each company group's attendance policy, when
 * `autoAbsentEnabled` is on AND today (Africa/Lagos) is a configured work day
 * AND the current WAT time is at/after `autoAbsentCutoff`, every ACTIVE tracked
 * staff member with no attendance record for today is stamped ABSENT (system
 * actor). Idempotent: re-running never overwrites an existing mark, so the top
 * of each subsequent hour only catches stragglers.
 *
 * The write itself lives in AttendanceService.autoMarkAbsentForDate; this class
 * only decides WHEN to run it per group.
 */
@Injectable()
export class AttendanceAutoAbsentService {
  private readonly logger = new Logger('AttendanceAutoAbsent');

  constructor(private readonly attendance: AttendanceService) {}

  /** Current Africa/Lagos date (YYYY-MM-DD), weekday (0=Sun..6=Sat) and HH:mm. */
  private nowInLagos(): { date: string; weekday: number; hhmm: string } {
    const now = new Date();
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now); // en-CA => YYYY-MM-DD
    const weekdayName = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Lagos', weekday: 'short',
    }).format(now);
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayName);
    const hhmm = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(now); // en-GB 24h => HH:mm
    return { date, weekday, hhmm };
  }

  @Cron('0 0 * * * *') // top of every hour
  async run(): Promise<void> {
    let policies;
    try {
      policies = await this.attendance.getAllPolicies();
    } catch (err) {
      this.logger.error(`Failed to load attendance policies: ${(err as Error).message}`);
      return;
    }
    if (policies.length === 0) return;

    const { date, weekday, hhmm } = this.nowInLagos();

    for (const { groupId, policy } of policies) {
      if (!policy.autoAbsentEnabled) continue;
      if (!policy.workDays.includes(weekday)) continue; // not a work day
      if (hhmm < policy.autoAbsentCutoff) continue; // before cutoff
      try {
        const { marked } = await this.attendance.autoMarkAbsentForDate(date, groupId);
        if (marked > 0) {
          this.logger.log(`Auto-marked ${marked} absent for ${date} (group ${groupId ?? 'global'}).`);
        }
      } catch (err) {
        this.logger.error(`Auto-absent failed for group ${groupId ?? 'global'}: ${(err as Error).message}`);
      }
    }
  }
}
