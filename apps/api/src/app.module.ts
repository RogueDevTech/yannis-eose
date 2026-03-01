import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './common/guards/auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { TrpcModule } from './trpc/trpc.module';
import { EventsModule } from './events/events.module';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [DatabaseModule, AuthModule, TrpcModule, EventsModule, OrdersModule],
  controllers: [AppController],
  providers: [
    // Global AuthGuard — all routes require authentication by default.
    // Use @Public() decorator to opt out.
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    // Global RolesGuard — enforces @Roles() decorator on routes.
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    // Global AuditInterceptor — injects actor ID into Postgres
    // session for every mutating request.
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
