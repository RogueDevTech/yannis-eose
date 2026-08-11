export { SlackModule } from './slack.module';
export { SlackService } from './slack.service';
export { SlackErrorBufferService } from './error-buffer.service';
export { SlackDailyReportService } from './daily-report.service';
export {
  YANNIS_EOSE_CHANNEL,
  AlertSeverity,
  SLACK_APP_NAME,
  SLACK_APP_EMOJI,
} from './slack-channels';
export * from './slack.types';
export * from './slack.helpers';
export { apiErrorTemplate } from './templates/api-error.template';
export type { ApiErrorAlertData } from './templates/api-error.template';
export { dailyReportTemplate } from './templates/daily-report.template';
export type { DailyReportData } from './templates/daily-report.template';
