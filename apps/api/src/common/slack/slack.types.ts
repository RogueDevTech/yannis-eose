export type SlackTextType = 'plain_text' | 'mrkdwn';

export interface SlackTextBlock {
  type: SlackTextType;
  text: string;
  emoji?: boolean;
}

export interface SlackButtonElement {
  type: 'button';
  text: SlackTextBlock;
  url: string;
  style?: 'primary' | 'danger';
}

export interface SlackImageElement {
  type: 'image';
  image_url: string;
  alt_text: string;
}

export type SlackBlockType =
  | 'header'
  | 'section'
  | 'divider'
  | 'context'
  | 'actions';

export interface SlackBlock {
  type: SlackBlockType;
  text?: SlackTextBlock;
  fields?: SlackTextBlock[];
  elements?: Array<SlackTextBlock | SlackImageElement | SlackButtonElement>;
  accessory?: SlackImageElement | SlackButtonElement;
}

export interface SlackAttachment {
  color: string;
  blocks: SlackBlock[];
}

export interface SlackTemplateResult {
  message: string;
  blocks: SlackBlock[];
  attachments?: SlackAttachment[];
  chunks?: SlackBlock[][];
}

export interface SlackField {
  label: string;
  value: string;
}

export interface SlackLinkButton {
  label: string;
  url: string | null | undefined;
  style?: 'primary' | 'danger';
}

export interface BuildAlertOptions {
  severity: import('./slack-channels').AlertSeverity;
  appName?: string;
  appEmoji?: string;
  title: string;
  summaryText: string;
  fields?: SlackField[];
  extraBlocks?: SlackBlock[];
  timestampExtra?: string;
  buttons?: SlackLinkButton[];
}
