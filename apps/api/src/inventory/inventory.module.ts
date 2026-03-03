import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { EventsModule } from '../events/events.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [EventsModule, NotificationsModule],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
