import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PushSchedulerService } from './push-scheduler.service';
import { PushController } from './push.controller';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [PushController],
  providers: [NotificationsService, PushSchedulerService],
  exports: [NotificationsService, PushSchedulerService],
})
export class NotificationsModule {}
