import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MarketingService } from './marketing.service';
import { AdSpendComplianceService } from './ad-spend-compliance.service';
import { BranchesModule } from '../branches/branches.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [EventsModule, NotificationsModule, BranchesModule, SettingsModule],
  providers: [MarketingService, AdSpendComplianceService],
  exports: [MarketingService],
})
export class MarketingModule {}
