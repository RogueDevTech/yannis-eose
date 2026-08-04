import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AutomationService } from './automation.service';
import { SuppressionService } from './suppression.service';
import { ChannelRegistryService } from './channels/channel-registry.service';
import { EmailChannelProvider } from './channels/email-channel.provider';
import { SmsChannelProvider } from './channels/sms-channel.provider';
import { WhatsappChannelProvider } from './channels/whatsapp-channel.provider';

// DatabaseModule is @Global() so DRIZZLE is available without importing it.
// NotificationsModule is imported so the email channel can reuse sendEmail().
@Module({
  imports: [NotificationsModule],
  providers: [
    AutomationService,
    SuppressionService,
    ChannelRegistryService,
    EmailChannelProvider,
    SmsChannelProvider,
    WhatsappChannelProvider,
  ],
  exports: [AutomationService],
})
export class AutomationModule {}
