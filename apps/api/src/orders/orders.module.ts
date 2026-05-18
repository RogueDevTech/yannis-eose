import { Module, forwardRef } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CsOrderRoutingService } from './cs-order-routing.service';
import { SettingsModule } from '../settings/settings.module';
import { CartModule } from '../cart/cart.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PaymentsModule } from '../payments/payments.module';
import { BranchesModule } from '../branches/branches.module';
import { CacheModule } from '../common/cache/cache.module';

@Module({
  imports: [
    SettingsModule,
    CartModule,
    NotificationsModule,
    InventoryModule,
    BranchesModule,
    CacheModule,
    forwardRef(() => PaymentsModule),
  ],
  providers: [OrdersService, CsOrderRoutingService],
  exports: [OrdersService, CsOrderRoutingService],
})
export class OrdersModule {}
