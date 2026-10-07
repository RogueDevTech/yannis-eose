import { Module } from '@nestjs/common';
import { CartService } from './cart.service';
import { CartOrdersModule } from '../cart-orders/cart-orders.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [CartOrdersModule, SettingsModule],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
