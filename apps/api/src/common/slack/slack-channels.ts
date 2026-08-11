/**
 * Single project-scoped Slack channel. This is a multi-project agency
 * workspace, so every alert for Yannis EOSE (API errors + the daily report)
 * routes to one dedicated channel, keeping this project's signal isolated
 * from other projects sharing the same workspace.
 *
 * Alert *type* (error vs report) is expressed by AlertSeverity, which drives
 * the accent-bar color, not by the channel.
 */
export const YANNIS_EOSE_CHANNEL = 'yannis-eose';

export enum AlertSeverity {
  SUCCESS = 'success',
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  REPORT = 'report',
}

export const SLACK_APP_NAME = 'Yannis EOSE';
export const SLACK_APP_EMOJI = ':shield:';
