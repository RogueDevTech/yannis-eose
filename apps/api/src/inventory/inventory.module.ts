import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { EventsModule } from '../events/events.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [EventsModule, NotificationsModule, SettingsModule],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
