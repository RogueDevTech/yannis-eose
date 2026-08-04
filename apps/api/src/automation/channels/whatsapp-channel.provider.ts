import { Injectable, Logger } from '@nestjs/common';
import type {
  MessageChannelProvider,
  ChannelSendRequest,
  ChannelSendResult,
} from './channel-provider.interface';

/**
 * WhatsApp channel — Meta WhatsApp Business Cloud API. Greenfield: no
 * programmatic WhatsApp sender exists today, and the Cloud API needs a verified
 * Meta Business number + pre-approved message templates (external, 24h+ lead
 * time). Placeholder for the thin slice: reports unconfigured so the engine
 * SKIPS WhatsApp sends until the account + templates are live.
 */
@Injectable()
export class WhatsappChannelProvider implements MessageChannelProvider {
  readonly channel = 'WHATSAPP' as const;
  private readonly logger = new Logger(WhatsappChannelProvider.name);

  isConfigured(): boolean {
    return false;
  }

  async send(_req: ChannelSendRequest): Promise<ChannelSendResult> {
    this.logger.warn('WhatsApp channel not yet implemented — send skipped.');
    return { success: false, error: 'WhatsApp channel not yet implemented.' };
  }
}
