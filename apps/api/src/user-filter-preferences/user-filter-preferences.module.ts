import { Module } from '@nestjs/common';
import { UserFilterPreferencesService } from './user-filter-preferences.service';
import { CacheModule } from '../common/cache/cache.module';

// DatabaseModule is @Global(), so DRIZZLE is available without importing it.
// CacheModule must be imported to inject CacheService.
@Module({
  imports: [CacheModule],
  providers: [UserFilterPreferencesService],
  exports: [UserFilterPreferencesService],
})
export class UserFilterPreferencesModule {}
