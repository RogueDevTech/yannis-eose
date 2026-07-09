import { Module } from '@nestjs/common';
import { HrService } from './hr.service';
import { PayrollBatchService } from './payroll-batch.service';
import { EventsModule } from '../events/events.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LedgerModule } from '../finance/ledger.module';

@Module({
  imports: [EventsModule, NotificationsModule, LedgerModule],
  providers: [HrService, PayrollBatchService],
  exports: [HrService, PayrollBatchService],
})
export class HrModule {}
