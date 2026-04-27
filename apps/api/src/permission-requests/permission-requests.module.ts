import { Module } from '@nestjs/common';
import { PermissionRequestsService } from './permission-requests.service';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProductsModule } from '../products/products.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [UsersModule, NotificationsModule, ProductsModule, OrdersModule],
  providers: [PermissionRequestsService],
  exports: [PermissionRequestsService],
})
export class PermissionRequestsModule {}
