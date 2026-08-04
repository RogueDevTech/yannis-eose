import { Injectable } from '@nestjs/common';
import { NotificationsService } from '../../notifications/notifications.service';
import type {
  MessageChannelProvider,
  ChannelSendRequest,
  ChannelSendResult,
} from './channel-provider.interface';

/**
 * Email channel — delegates to the existing SendGrid transport in
 * NotificationsService.sendEmail(). That method is generic (to/subject/html/text)
 * and already handles the "not configured" and failure cases gracefully; we adapt
 * its boolean result to the channel contract.
 */
@Injectable()
export class EmailChannelProvider implements MessageChannelProvider {
  readonly channel = 'EMAIL' as const;

  constructor(private readonly notifications: NotificationsService) {}

  isConfigured(): boolean {
    // Same signal NotificationsService uses internally to decide whether to send.
    return Boolean(process.env['SENDGRID_API_KEY']);
  }

  async send(req: ChannelSendRequest): Promise<ChannelSendResult> {
    const html = req.html ?? escapeToHtml(req.body);
    const sent = await this.notifications.sendEmail({
      to: req.to,
      subject: req.subject ?? 'A message from Yannis',
      html,
      text: req.body,
    });
    return sent
      ? { success: true }
      : { success: false, error: 'Email transport declined or failed (see server logs).' };
  }
}

/** Minimal plain-text → HTML: escape and preserve line breaks. */
function escapeToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<p>${escaped.replace(/\n/g, '<br/>')}</p>`;
}
