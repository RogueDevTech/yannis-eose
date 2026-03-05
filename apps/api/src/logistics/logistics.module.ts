import { Module, forwardRef } from '@nestjs/common';
import { LogisticsService } from './logistics.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [NotificationsModule, forwardRef(() => OrdersModule)],
  providers: [LogisticsService],
  exports: [LogisticsService],
})
export class LogisticsModule {}
