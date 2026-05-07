import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OnboardingService } from './onboarding.service';
import { CacheModule } from '../common/cache/cache.module';

@Module({
  imports: [DatabaseModule, NotificationsModule, CacheModule],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
