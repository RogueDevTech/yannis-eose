import { Module, forwardRef } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { SessionStoreService } from './session-store.service';
import { BranchesModule } from '../branches/branches.module';

@Module({
  imports: [forwardRef(() => UsersModule), NotificationsModule, PermissionsModule, BranchesModule],
  controllers: [AuthController],
  providers: [AuthService, SessionStoreService],
  exports: [AuthService, SessionStoreService],
})
export class AuthModule {}
