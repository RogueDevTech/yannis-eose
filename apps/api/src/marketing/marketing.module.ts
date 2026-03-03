import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MarketingService } from './marketing.service';

@Module({
  imports: [EventsModule, NotificationsModule],
  providers: [MarketingService],
  exports: [MarketingService],
})
export class MarketingModule {}
