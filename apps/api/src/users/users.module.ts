import { Module, forwardRef } from '@nestjs/common';
import { UsersService } from './users.service';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [forwardRef(() => AuthModule), NotificationsModule, PermissionsModule],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
