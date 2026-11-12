import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { ShipmentsService } from './shipments.service';
import { ReservationReleaseService } from './reservation-release.service';
import { EventsModule } from '../events/events.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { LedgerModule } from '../finance/ledger.module';

@Module({
  imports: [EventsModule, NotificationsModule, SettingsModule, LedgerModule],
  providers: [InventoryService, ShipmentsService, ReservationReleaseService],
  exports: [InventoryService, ShipmentsService],
})
export class InventoryModule {}
