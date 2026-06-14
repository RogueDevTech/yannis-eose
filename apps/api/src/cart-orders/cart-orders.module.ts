import { Module } from '@nestjs/common';
import { CartOrdersService } from './cart-orders.service';

@Module({
  providers: [CartOrdersService],
  exports: [CartOrdersService],
})
export class CartOrdersModule {}
