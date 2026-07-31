import { Module, forwardRef } from '@nestjs/common';
import { LogisticsService } from './logistics.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { LedgerModule } from '../finance/ledger.module';
import { CacheModule } from '../common/cache/cache.module';

@Module({
  imports: [NotificationsModule, forwardRef(() => OrdersModule), LedgerModule, CacheModule],
  providers: [LogisticsService],
  exports: [LogisticsService],
})
export class LogisticsModule {}
