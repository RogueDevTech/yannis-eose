import { Module, forwardRef } from '@nestjs/common';
import { LogisticsService } from './logistics.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { LedgerModule } from '../finance/ledger.module';

@Module({
  imports: [NotificationsModule, forwardRef(() => OrdersModule), LedgerModule],
  providers: [LogisticsService],
  exports: [LogisticsService],
})
export class LogisticsModule {}
