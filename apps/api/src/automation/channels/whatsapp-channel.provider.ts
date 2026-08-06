import { Injectable, Logger } from '@nestjs/common';
import type {
  MessageChannelProvider,
  ChannelSendRequest,
  ChannelSendResult,
} from './channel-provider.interface';

/**
 * WhatsApp channel — Termii (`/api/sms/send`, channel = "whatsapp").
 *
 * Termii fronts WhatsApp Business messaging behind a simple JSON API, avoiding
 * the direct Meta Cloud API onboarding. Config via `TERMII_API_KEY` +
 * `TERMII_WHATSAPP_SENDER_ID` (the approved WhatsApp sender/device id). Optional
 * `TERMII_BASE_URL` overrides the host.
 *
 * `isConfigured()` is env-gated: until both are present the engine SKIPS
 * WhatsApp sends (never errors them). Contract: never throws for a normal
 * delivery failure — returns {success:false}.
 */
@Injectable()
export class WhatsappChannelProvider implements MessageChannelProvider {
  readonly channel = 'WHATSAPP' as const;
  private readonly logger = new Logger(WhatsappChannelProvider.name);

  private get apiKey(): string | undefined {
    return process.env['TERMII_API_KEY']?.trim() || undefined;
  }
  private get senderId(): string | undefined {
    return process.env['TERMII_WHATSAPP_SENDER_ID']?.trim() || undefined;
  }
  private get baseUrl(): string {
    return (process.env['TERMII_BASE_URL']?.trim() || 'https://api.ng.termii.com').replace(/\/$/, '');
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.senderId);
  }

  async send(req: ChannelSendRequest): Promise<ChannelSendResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: 'WhatsApp channel not configured (TERMII_API_KEY / TERMII_WHATSAPP_SENDER_ID missing).',
      };
    }

    try {
      const res = await fetch(`${this.baseUrl}/api/sms/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          to: req.to,
          from: this.senderId,
          sms: req.body,
          type: 'plain',
          channel: 'whatsapp',
          api_key: this.apiKey,
        }),
      });

      const json = (await res.json().catch(() => null)) as {
        message_id?: string;
        code?: string;
        message?: string;
      } | null;

      if (!res.ok) {
        return {
          success: false,
          error: `Termii HTTP ${res.status}${json?.message ? `: ${json.message}` : ''}`,
        };
      }

      // Termii returns a message_id on a queued/accepted send.
      if (json?.message_id) {
        return { success: true, providerMessageId: json.message_id };
      }
      return {
        success: false,
        error: `Termii did not accept the message${json?.message ? `: ${json.message}` : ''}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`WhatsApp send failed: ${message}`);
      return { success: false, error: `WhatsApp transport error: ${message}` };
    }
  }
}
