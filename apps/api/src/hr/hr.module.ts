import { Module } from '@nestjs/common';
import { HrService } from './hr.service';
import { EventsModule } from '../events/events.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [EventsModule, NotificationsModule],
  providers: [HrService],
  exports: [HrService],
})
export class HrModule {}
