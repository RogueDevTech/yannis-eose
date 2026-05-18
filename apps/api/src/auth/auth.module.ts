import { Module, forwardRef } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { SessionStoreService } from './session-store.service';
import { UserBundleCacheService } from './user-bundle-cache.service';
import { BranchesModule } from '../branches/branches.module';
import { CacheModule } from '../common/cache/cache.module';

@Module({
  imports: [forwardRef(() => UsersModule), NotificationsModule, PermissionsModule, BranchesModule, CacheModule],
  controllers: [AuthController],
  providers: [AuthService, SessionStoreService, UserBundleCacheService],
  exports: [AuthService, SessionStoreService, UserBundleCacheService],
})
export class AuthModule {}
