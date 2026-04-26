import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { MarketingModule } from '../marketing/marketing.module';
import { InventoryModule } from '../inventory/inventory.module';
import { FinanceModule } from '../finance/finance.module';
import { ReportsService } from './reports.service';

@Module({
  imports: [OrdersModule, MarketingModule, InventoryModule, FinanceModule],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}

