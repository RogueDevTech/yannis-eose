import { Global, Module } from '@nestjs/common';
import { SlackService } from './slack.service';
import { SlackErrorBufferService } from './error-buffer.service';
import { SlackDailyReportService } from './daily-report.service';

@Global()
@Module({
  providers: [SlackService, SlackErrorBufferService, SlackDailyReportService],
  exports: [SlackService, SlackErrorBufferService],
})
export class SlackModule {}
