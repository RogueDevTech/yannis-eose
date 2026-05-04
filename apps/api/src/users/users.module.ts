import { Module, forwardRef } from '@nestjs/common';
import { UsersService } from './users.service';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [forwardRef(() => AuthModule), NotificationsModule, PermissionsModule, EventsModule],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
