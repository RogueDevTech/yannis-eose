import { Module } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
