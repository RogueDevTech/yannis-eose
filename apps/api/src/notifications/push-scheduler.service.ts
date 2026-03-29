import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { NotificationsService } from './notifications.service';

/**
 * PushSchedulerService — registers and manages dynamic cron jobs for CRON-based
 * push automation rules. On startup it loads all active CRON rules from the database
 * and registers them with NestJS's SchedulerRegistry so they fire on their defined schedule.
 *
 * When automation rules are created/updated/toggled via the tRPC router, the router
 * calls `reloadCronJobs()` (or `registerCronJob()` / `unregisterCronJob()` directly)
 * to keep the in-memory scheduler in sync with the database.
 */
@Injectable()
export class PushSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(PushSchedulerService.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  /**
   * On module init — load all active CRON automation rules and register them.
   */
  async onModuleInit() {
    await this.reloadCronJobs();
  }

  /**
   * Reload all push_automation cron jobs from the database.
   * Clears any previously registered jobs with the push_automation_ prefix first.
   */
  async reloadCronJobs(): Promise<void> {
    // Remove all existing push_automation cron jobs
    const jobs = this.schedulerRegistry.getCronJobs();
    jobs.forEach((_, name) => {
      if (name.startsWith('push_automation_')) {
        try {
          this.schedulerRegistry.deleteCronJob(name);
        } catch {
          // Job may have already been removed — ignore
        }
      }
    });

    // Fetch all active CRON rules (branchId=null = SuperAdmin bypass → all branches)
    let rules: Awaited<ReturnType<NotificationsService['getAutomationRules']>>;
    try {
      rules = await this.notifications.getAutomationRules(null);
    } catch (err) {
      this.logger.error(`Failed to load automation rules on init: ${err}`);
      return;
    }

    const cronRules = rules.filter(
      (r) => r.triggerType === 'CRON' && r.isActive && r.cronExpr,
    );

    for (const rule of cronRules) {
      if (rule.cronExpr) {
        this.registerCronJob(rule.id, rule.cronExpr);
      }
    }

    this.logger.log(
      `Registered ${cronRules.length} push automation cron job(s)`,
    );
  }

  /**
   * Register a single cron job for a push automation rule.
   * Safe to call multiple times — will not register duplicates (uses named jobs).
   */
  registerCronJob(ruleId: string, cronExpr: string): void {
    const jobName = `push_automation_${ruleId}`;

    // Remove existing job for this rule if it exists
    try {
      this.schedulerRegistry.deleteCronJob(jobName);
    } catch {
      // Job didn't exist — this is fine
    }

    try {
      const job = new CronJob(cronExpr, () => {
        this.notifications.fireAutomationRule(ruleId).catch((err: unknown) => {
          this.logger.error(
            `Failed to fire automation rule ${ruleId}: ${err}`,
          );
        });
      });

      this.schedulerRegistry.addCronJob(jobName, job);
      job.start();
      this.logger.log(
        `Cron job registered: ${jobName} (expr: "${cronExpr}")`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to register cron job for rule ${ruleId}: ${err}`,
      );
    }
  }

  /**
   * Unregister a cron job for a push automation rule.
   * Called when a rule is toggled inactive or deleted.
   */
  unregisterCronJob(ruleId: string): void {
    const jobName = `push_automation_${ruleId}`;
    try {
      this.schedulerRegistry.deleteCronJob(jobName);
      this.logger.log(`Cron job removed: ${jobName}`);
    } catch {
      // Job may not have been registered (EVENT-type rules have no cron) — ignore
    }
  }
}
