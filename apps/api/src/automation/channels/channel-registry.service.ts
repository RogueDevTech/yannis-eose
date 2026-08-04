import { Injectable } from '@nestjs/common';
import type { AutomationChannel, MessageChannelProvider } from './channel-provider.interface';
import { EmailChannelProvider } from './email-channel.provider';
import { SmsChannelProvider } from './sms-channel.provider';
import { WhatsappChannelProvider } from './whatsapp-channel.provider';

/**
 * Resolves a channel-agnostic provider by channel. The engine asks the registry
 * for a provider and calls `send()` without knowing the channel. Adding a channel
 * = register one more provider here.
 */
@Injectable()
export class ChannelRegistryService {
  private readonly byChannel: Record<AutomationChannel, MessageChannelProvider>;

  constructor(
    email: EmailChannelProvider,
    sms: SmsChannelProvider,
    whatsapp: WhatsappChannelProvider,
  ) {
    this.byChannel = { EMAIL: email, SMS: sms, WHATSAPP: whatsapp };
  }

  get(channel: AutomationChannel): MessageChannelProvider {
    return this.byChannel[channel];
  }

  /** Channels whose credentials are present (usable right now). */
  configuredChannels(): AutomationChannel[] {
    return (Object.keys(this.byChannel) as AutomationChannel[]).filter((c) =>
      this.byChannel[c].isConfigured(),
    );
  }
}
