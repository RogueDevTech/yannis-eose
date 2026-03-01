import { Module, type NestModule, type MiddlewareConsumer, type OnModuleInit } from '@nestjs/common';
import { TrpcMiddleware } from './trpc.middleware';
import { OrdersModule } from '../orders/orders.module';
import { OrdersService } from '../orders/orders.service';
import { setOrdersService } from './routers/orders.router';

@Module({
  imports: [OrdersModule],
  providers: [TrpcMiddleware],
})
export class TrpcModule implements NestModule, OnModuleInit {
  constructor(private readonly ordersService: OrdersService) {}

  onModuleInit() {
    // Inject NestJS service instances into tRPC routers
    setOrdersService(this.ordersService);
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TrpcMiddleware).forRoutes('/trpc');
  }
}
