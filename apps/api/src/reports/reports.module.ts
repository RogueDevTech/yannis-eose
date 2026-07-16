import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { MarketingModule } from '../marketing/marketing.module';
import { InventoryModule } from '../inventory/inventory.module';
import { FinanceModule } from '../finance/finance.module';
import { LedgerModule } from '../finance/ledger.module';
import { UsersModule } from '../users/users.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { BranchesModule } from '../branches/branches.module';
import { CartOrdersModule } from '../cart-orders/cart-orders.module';
import { HrModule } from '../hr/hr.module';
import { ProductsModule } from '../products/products.module';
import { ReportsService } from './reports.service';

@Module({
  imports: [OrdersModule, MarketingModule, InventoryModule, FinanceModule, LedgerModule, UsersModule, LogisticsModule, BranchesModule, CartOrdersModule, HrModule, ProductsModule],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}

