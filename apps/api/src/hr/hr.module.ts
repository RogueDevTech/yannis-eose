import { Module } from '@nestjs/common';
import { HrService } from './hr.service';
import { PayrollBatchService } from './payroll-batch.service';
import { PayrollMetricsService } from './payroll-metrics.service';
import { PayrollComputeService } from './payroll-compute.service';
import { PayrollConfigService } from './payroll-config.service';
import { EventsModule } from '../events/events.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LedgerModule } from '../finance/ledger.module';

@Module({
  imports: [EventsModule, NotificationsModule, LedgerModule],
  providers: [
    HrService,
    PayrollBatchService,
    PayrollMetricsService,
    PayrollComputeService,
    PayrollConfigService,
  ],
  exports: [HrService, PayrollBatchService, PayrollMetricsService, PayrollComputeService, PayrollConfigService],
})
export class HrModule {}
