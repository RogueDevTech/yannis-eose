import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './common/guards/auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { FinanceFieldsInterceptor } from './common/interceptors/finance-fields.interceptor';
import { RequestTimingModule } from './common/request-timing.module';
import { TrpcModule } from './trpc/trpc.module';
import { EventsModule } from './events/events.module';
import { OrdersModule } from './orders/orders.module';
import { UsersModule } from './users/users.module';
import { ProductsModule } from './products/products.module';
import { InventoryModule } from './inventory/inventory.module';
import { LogisticsModule } from './logistics/logistics.module';
import { MarketingModule } from './marketing/marketing.module';
import { FinanceModule } from './finance/finance.module';
import { HrModule } from './hr/hr.module';
import { NotificationsModule } from './notifications/notifications.module';
import { VoipModule } from './voip/voip.module';
import { SettingsModule } from './settings/settings.module';
import { CartModule } from './cart/cart.module';
import { PermissionRequestsModule } from './permission-requests/permission-requests.module';
import { PaymentsModule } from './payments/payments.module';
import { OnboardingModule } from './onboarding/onboarding.module';

@Module({
  imports: [
    RequestTimingModule,
    ScheduleModule.forRoot(),
    // Rate limiting — 100 requests per 60 seconds per IP
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    DatabaseModule, AuthModule, TrpcModule, EventsModule,
    OrdersModule, UsersModule, ProductsModule, InventoryModule,
    LogisticsModule, MarketingModule, FinanceModule, HrModule,
    NotificationsModule, VoipModule, SettingsModule, CartModule,
    PermissionRequestsModule, PaymentsModule, OnboardingModule,
  ],
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
    // Global ThrottlerGuard — enforces rate limiting (100 req/60s per IP).
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Global AuditInterceptor — injects actor ID into Postgres
    // session for every mutating request.
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
    // Global FinanceFieldsInterceptor — strips cost/margin fields
    // from REST responses for non-finance roles (PRD 11.3).
    // tRPC routes have their own middleware for this.
    {
      provide: APP_INTERCEPTOR,
      useClass: FinanceFieldsInterceptor,
    },
  ],
})
export class AppModule {}
