import { AlertSeverity, SLACK_APP_NAME, SLACK_APP_EMOJI } from './slack-channels';
import type {
  SlackBlock,
  SlackAttachment,
  SlackField,
  SlackLinkButton,
  SlackTextBlock,
  SlackButtonElement,
  BuildAlertOptions,
  SlackTemplateResult,
} from './slack.types';

const TIMESTAMP_FORMAT: Intl.DateTimeFormatOptions = {
  timeZone: 'Africa/Lagos',
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

export function getTimestamp(at: Date = new Date()): string {
  return `${new Intl.DateTimeFormat('en-GB', TIMESTAMP_FORMAT).format(at)} WAT`;
}

export function formatNaira(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function header(text: string): SlackBlock {
  return {
    type: 'header',
    text: { type: 'plain_text', text: truncate(text, 150), emoji: true },
  };
}

export function summary(text: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

export function twoColumnSection(fields: SlackField[]): SlackBlock {
  return {
    type: 'section',
    fields: fields.map<SlackTextBlock>((f) => ({
      type: 'mrkdwn',
      text: `*${f.label}*\n${f.value}`,
    })),
  };
}

export function contextLine(text: string): SlackBlock {
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] };
}

export function timestampContext(extra?: string): SlackBlock {
  const stamp = `:clock3: ${getTimestamp()}`;
  return contextLine(extra ? `${stamp}  ·  ${extra}` : stamp);
}

export function divider(): SlackBlock {
  return { type: 'divider' };
}

export function codeBlock(text: string): SlackBlock {
  return summary('```' + truncate(text, 2800) + '```');
}

export function contextHeader(emoji: string, name: string): SlackBlock {
  return contextLine(`${emoji} *${name}*`);
}

export function actions(buttons: SlackLinkButton[]): SlackBlock | null {
  const elements = buttons
    .filter((b): b is SlackLinkButton & { url: string } => Boolean(b.url))
    .map<SlackButtonElement>((b) => ({
      type: 'button',
      text: { type: 'plain_text', text: b.label, emoji: true },
      url: b.url,
      ...(b.style ? { style: b.style } : {}),
    }));
  if (elements.length === 0) return null;
  return { type: 'actions', elements };
}

export function attachment(color: string, blocks: SlackBlock[]): SlackAttachment {
  return { color, blocks };
}

const SEVERITY_COLORS: Record<AlertSeverity, string> = {
  [AlertSeverity.SUCCESS]: '#2eb67d',
  [AlertSeverity.INFO]: '#4a90d9',
  [AlertSeverity.WARNING]: '#e8a13a',
  [AlertSeverity.ERROR]: '#e01e5a',
  [AlertSeverity.REPORT]: '#616061',
};

export function severityColor(severity: AlertSeverity): string {
  return SEVERITY_COLORS[severity] ?? '#616061';
}

export function buildAlert(
  message: string,
  options: BuildAlertOptions,
): SlackTemplateResult {
  const blocks: SlackBlock[] = [
    contextHeader(options.appEmoji ?? SLACK_APP_EMOJI, options.appName ?? SLACK_APP_NAME),
    summary(`*${options.title}*`),
    summary(options.summaryText),
  ];

  const fields = (options.fields ?? []).filter((f) => f.value && f.value.length > 0);
  if (fields.length > 0) blocks.push(twoColumnSection(fields));

  if (options.extraBlocks && options.extraBlocks.length > 0) {
    blocks.push(...options.extraBlocks);
  }

  blocks.push(timestampContext(options.timestampExtra));

  const actionsBlock = options.buttons ? actions(options.buttons) : null;
  if (actionsBlock) blocks.push(actionsBlock);

  return {
    message,
    blocks: [],
    attachments: [attachment(severityColor(options.severity), blocks)],
  };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
