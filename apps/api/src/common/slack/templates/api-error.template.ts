import { buildAlert, codeBlock } from '../slack.helpers';
import { AlertSeverity, SLACK_APP_NAME, SLACK_APP_EMOJI } from '../slack-channels';
import type { SlackTemplateResult } from '../slack.types';

export interface ApiErrorAlertData {
  path: string;
  code: string;
  message: string;
  userId?: string;
  userRole?: string;
  branchId?: string;
  requestId?: string;
  stack?: string;
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
      { label: 'Code', value: data.code },
      { label: 'User', value: data.userId ? `${data.userId}` : 'anonymous' },
      { label: 'Role', value: data.userRole ?? '—' },
      { label: 'Branch', value: data.branchId ?? '—' },
      { label: 'Request', value: data.requestId ?? '—' },
    ],
    extraBlocks,
  });
}
