import { Module, forwardRef } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { SettingsModule } from '../settings/settings.module';
import { CartModule } from '../cart/cart.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PaymentsModule } from '../payments/payments.module';
import { BranchesModule } from '../branches/branches.module';

@Module({
  imports: [
    SettingsModule,
    CartModule,
    NotificationsModule,
    InventoryModule,
    BranchesModule,
    forwardRef(() => PaymentsModule),
  ],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
