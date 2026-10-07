import { Module } from '@nestjs/common';
import { CartOrdersService } from './cart-orders.service';
import { InventoryModule } from '../inventory/inventory.module';
import { LedgerModule } from '../finance/ledger.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  // InventoryModule + LedgerModule let graduation deduct stock and post the
  // sale exactly once. This direction is acyclic: neither module imports
  // cart-orders (OrdersModule imports both cart-orders and inventory — a
  // diamond, not a cycle).
  imports: [InventoryModule, LedgerModule, SettingsModule],
  providers: [CartOrdersService],
  exports: [CartOrdersService],
})
export class CartOrdersModule {}
