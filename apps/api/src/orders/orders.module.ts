import { Module, forwardRef } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CsOrderRoutingService } from './cs-order-routing.service';
import { TestOrderPurgeService } from './test-order-purge.service';
import { FollowUpConfigService } from './follow-up-config.service';
import { SettingsModule } from '../settings/settings.module';
import { CartModule } from '../cart/cart.module';
import { CartOrdersModule } from '../cart-orders/cart-orders.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PaymentsModule } from '../payments/payments.module';
import { BranchesModule } from '../branches/branches.module';
import { CacheModule } from '../common/cache/cache.module';
import { LedgerModule } from '../finance/ledger.module';

@Module({
  imports: [
    SettingsModule,
    CartModule,
    CartOrdersModule,
    NotificationsModule,
    InventoryModule,
    BranchesModule,
    CacheModule,
    LedgerModule,
    forwardRef(() => PaymentsModule),
  ],
  providers: [OrdersService, CsOrderRoutingService, TestOrderPurgeService, FollowUpConfigService],
  exports: [OrdersService, CsOrderRoutingService, TestOrderPurgeService, FollowUpConfigService],
})
export class OrdersModule {}
