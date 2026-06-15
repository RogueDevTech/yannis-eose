import { Module } from '@nestjs/common';
import { CartService } from './cart.service';
import { CartOrdersModule } from '../cart-orders/cart-orders.module';

@Module({
  imports: [CartOrdersModule],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
