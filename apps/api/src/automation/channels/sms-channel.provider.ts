import { Injectable, Logger } from '@nestjs/common';
import type {
  MessageChannelProvider,
  ChannelSendRequest,
  ChannelSendResult,
} from './channel-provider.interface';

/**
 * SMS channel — Africa's Talking. Placeholder for the thin slice: the real
 * `/version1/messaging` call lands in a later phase (the AT keys AT_USERNAME /
 * AT_API_KEY already exist for VOIP). Until then it reports unconfigured so the
 * engine SKIPS SMS sends rather than failing them.
 */
@Injectable()
export class SmsChannelProvider implements MessageChannelProvider {
  readonly channel = 'SMS' as const;
  private readonly logger = new Logger(SmsChannelProvider.name);

  isConfigured(): boolean {
    // Flip on once the real AT send is implemented; for now the slice ships email-only.
    return false;
  }

  async send(_req: ChannelSendRequest): Promise<ChannelSendResult> {
    this.logger.warn('SMS channel not yet implemented — send skipped.');
    return { success: false, error: 'SMS channel not yet implemented.' };
  }
}
