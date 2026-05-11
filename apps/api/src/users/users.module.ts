import { Module, forwardRef } from '@nestjs/common';
import { UsersService } from './users.service';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { BranchesModule } from '../branches/branches.module';
import { CacheModule } from '../common/cache/cache.module';
import { HeadOfMarketingPermissionRestampService } from './head-of-marketing-permission-restamp.service';

// EventsModule is @Global() — its providers (EventsService) are available
// via DI without an explicit import. Adding it here creates a circular
// dependency loop: AuthModule → UsersModule → EventsModule → AuthModule.
@Module({
  imports: [
    forwardRef(() => AuthModule),
    NotificationsModule,
    PermissionsModule,
    BranchesModule,
    CacheModule,
  ],
  providers: [UsersService, HeadOfMarketingPermissionRestampService],
  exports: [UsersService],
})
export class UsersModule {}
