import { Injectable, Logger } from '@nestjs/common';
import type {
  MessageChannelProvider,
  ChannelSendRequest,
  ChannelSendResult,
} from './channel-provider.interface';

/**
 * SMS channel — Africa's Talking (`/version1/messaging`).
 *
 * Reuses the AT credentials already provisioned for the VOIP work
 * (`AT_USERNAME` / `AT_API_KEY`). An optional `AT_SMS_SENDER_ID` sets the sender
 * (alphanumeric sender id / short code) when the account has one approved.
 *
 * `isConfigured()` is env-gated: until both keys are present the engine SKIPS
 * SMS sends (never errors them), so a rule created before keys are set simply
 * doesn't transmit on this channel rather than failing the whole job.
 *
 * Contract: never throws for a normal delivery failure — returns {success:false}.
 */
@Injectable()
export class SmsChannelProvider implements MessageChannelProvider {
  readonly channel = 'SMS' as const;
  private readonly logger = new Logger(SmsChannelProvider.name);

  private get username(): string | undefined {
    return process.env['AT_USERNAME']?.trim() || undefined;
  }
  private get apiKey(): string | undefined {
    return process.env['AT_API_KEY']?.trim() || undefined;
  }
  private get senderId(): string | undefined {
    return process.env['AT_SMS_SENDER_ID']?.trim() || undefined;
  }
  /** Sandbox uses a different host + the literal username "sandbox". */
  private get baseUrl(): string {
    return this.username === 'sandbox'
      ? 'https://api.sandbox.africastalking.com/version1/messaging'
      : 'https://api.africastalking.com/version1/messaging';
  }

  isConfigured(): boolean {
    return Boolean(this.username && this.apiKey);
  }

  async send(req: ChannelSendRequest): Promise<ChannelSendResult> {
    if (!this.isConfigured()) {
      return { success: false, error: 'SMS channel not configured (AT_USERNAME / AT_API_KEY missing).' };
    }

    const params = new URLSearchParams();
    params.set('username', this.username!);
    params.set('to', req.to);
    params.set('message', req.body);
    if (this.senderId) params.set('from', this.senderId);

    try {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          apiKey: this.apiKey!,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: params.toString(),
      });

      const json = (await res.json().catch(() => null)) as {
        SMSMessageData?: {
          Recipients?: Array<{ status?: string; statusCode?: number; messageId?: string; number?: string }>;
        };
      } | null;

      if (!res.ok) {
        return { success: false, error: `Africa's Talking HTTP ${res.status}` };
      }

      const recipient = json?.SMSMessageData?.Recipients?.[0];
      // AT returns "Success" per recipient; anything else is a per-number failure.
      if (recipient?.status === 'Success') {
        return { success: true, providerMessageId: recipient.messageId };
      }
      return {
        success: false,
        error: `Africa's Talking rejected the recipient: ${recipient?.status ?? 'unknown status'}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`SMS send failed: ${message}`);
      return { success: false, error: `SMS transport error: ${message}` };
    }
  }
}
