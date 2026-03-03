import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { SettingsModule } from '../settings/settings.module';
import { CartModule } from '../cart/cart.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [SettingsModule, CartModule, NotificationsModule],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
