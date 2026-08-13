import { Module } from '@nestjs/common';
import { HrService } from './hr.service';
import { PayrollBatchService } from './payroll-batch.service';
import { PayrollMetricsService } from './payroll-metrics.service';
import { PayrollComputeService } from './payroll-compute.service';
import { PayrollConfigService } from './payroll-config.service';
import { AttendanceService } from './attendance.service';
import { AttendanceAutoAbsentService } from './attendance-auto-absent.service';
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
    AttendanceService,
    AttendanceAutoAbsentService,
  ],
  exports: [HrService, PayrollBatchService, PayrollMetricsService, PayrollComputeService, PayrollConfigService, AttendanceService],
})
export class HrModule {}
