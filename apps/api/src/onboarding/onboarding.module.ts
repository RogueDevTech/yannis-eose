import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [DatabaseModule, NotificationsModule],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
