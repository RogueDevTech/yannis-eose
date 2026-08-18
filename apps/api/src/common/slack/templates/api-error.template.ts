import { buildAlert, codeBlock } from '../slack.helpers';
import { AlertSeverity, SLACK_APP_NAME, SLACK_APP_EMOJI } from '../slack-channels';
import type { SlackTemplateResult } from '../slack.types';

export interface ApiErrorAlertData {
  path: string;
  code: string;
  message: string;
  page?: string;
  userId?: string;
  /** Human name of the user, resolved from the session. Rendered alongside the id. */
  userName?: string;
  userRole?: string;
  branchId?: string;
  /** Human name of the branch, resolved from a cached lookup. Rendered alongside the id. */
  branchName?: string;
  requestId?: string;
  stack?: string;
}

/**
 * Renders a "Name (id)" label so the alert is readable at a glance while keeping
 * the raw id for lookups. Falls back to the id alone (no name), or `fallback`.
 */
function labelWithId(id: string | undefined, name: string | undefined, fallback: string): string {
  if (!id) return fallback;
  return name ? `${name} (${id})` : id;
}

export function apiErrorTemplate(data: ApiErrorAlertData): SlackTemplateResult {
  const extraBlocks = data.stack ? [codeBlock(data.stack)] : undefined;

  return buildAlert(`API error: ${data.path}`, {
    severity: AlertSeverity.ERROR,
    appName: SLACK_APP_NAME,
    appEmoji: SLACK_APP_EMOJI,
    title: `:rotating_light: API Error — ${data.path}`,
    summaryText: '`' + data.message + '`',
    fields: [
      { label: 'Procedure', value: '`' + data.path + '`' },
      { label: 'Page', value: data.page ?? '—' },
      { label: 'Code', value: data.code },
      { label: 'User', value: labelWithId(data.userId, data.userName, 'anonymous') },
      { label: 'Role', value: data.userRole ?? '—' },
      { label: 'Branch', value: labelWithId(data.branchId, data.branchName, '—') },
      { label: 'Request', value: data.requestId ?? '—' },
    ],
    extraBlocks,
  });
}
