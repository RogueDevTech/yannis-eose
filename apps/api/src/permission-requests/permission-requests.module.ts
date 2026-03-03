import { Module } from '@nestjs/common';
import { PermissionRequestsService } from './permission-requests.service';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [UsersModule, NotificationsModule],
  providers: [PermissionRequestsService],
  exports: [PermissionRequestsService],
})
export class PermissionRequestsModule {}
