import { Inject, Module, type MiddlewareConsumer, type NestModule, type OnModuleInit } from '@nestjs/common';
import { TrpcMiddleware } from './trpc.middleware';
import { OrdersModule } from '../orders/orders.module';
import { OrdersService } from '../orders/orders.service';
import { setOrdersCacheService, setOrdersService, setVoipService } from './routers/orders.router';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';
import { setUsersCacheService, setUsersService, setUsersSessionStore } from './routers/users.router';
import { ProductsModule } from '../products/products.module';
import { ProductsService } from '../products/products.service';
import { setProductsCacheService, setProductsService } from './routers/products.router';
import { ProductCategoriesService } from '../products/product-categories.service';
import { setProductCategoriesService } from './routers/product-categories.router';
import { InventoryModule } from '../inventory/inventory.module';
import { InventoryService } from '../inventory/inventory.service';
import { ShipmentsService } from '../inventory/shipments.service';
import { setInventoryService, setShipmentsService, setLogisticsServiceForInventory } from './routers/inventory.router';
import { LogisticsModule } from '../logistics/logistics.module';
import { LogisticsService } from '../logistics/logistics.service';
import { setLogisticsCacheService, setLogisticsService } from './routers/logistics.router';
import { MarketingModule } from '../marketing/marketing.module';
import { MarketingService } from '../marketing/marketing.service';
import { setMarketingService } from './routers/marketing.router';
import { FinanceModule } from '../finance/finance.module';
import { FinanceService } from '../finance/finance.service';
import { setFinanceService } from './routers/finance.router';
import { HrModule } from '../hr/hr.module';
import { HrService } from '../hr/hr.service';
import { PayrollBatchService } from '../hr/payroll-batch.service';
import { setHrService, setPayrollBatchService } from './routers/hr.router';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';
import { PushSchedulerService } from '../notifications/push-scheduler.service';
import { setNotificationsService, setPushSchedulerService } from './routers/notifications.router';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { setAuditCacheService, setAuditService } from './routers/audit.router';
import { VoipModule } from '../voip/voip.module';
import { VoipService } from '../voip/voip.service';
import { setDashboardServices } from './routers/dashboard.router';
import { setVoipServiceForRouter } from './routers/voip.router';
import { SettingsModule } from '../settings/settings.module';
import { SettingsService } from '../settings/settings.service';
import { setSettingsService, setSettingsDb } from './routers/settings.router';
import { setCartService } from './routers/cart.router';
import { CartModule } from '../cart/cart.module';
import { CartService } from '../cart/cart.service';
import { PermissionsModule } from '../permissions/permissions.module';
import { PermissionRequestsModule } from '../permission-requests/permission-requests.module';
import { PermissionRequestsService } from '../permission-requests/permission-requests.service';
import { setPermissionRequestsService } from './routers/permission-requests.router';
import {
  setBranchesDb,
  setBranchesCacheService,
  setBranchesSessionStore,
  setBranchesNotificationsService,
  setBranchTeamsService,
  setBranchesSettingsService,
} from './routers/branches.router';
import { BranchesModule } from '../branches/branches.module';
import { BranchTeamsService } from '../branches/branch-teams.service';
import { setMessagingDb, setMessagingCacheService } from './routers/messaging.router';
import { DRIZZLE, DatabaseModule } from '../database/database.module';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { db as schema } from '@yannis/shared';
import { SessionStoreService } from '../auth/session-store.service';
import { AuthModule } from '../auth/auth.module';
import { CacheModule } from '../common/cache/cache.module';
import { CacheService } from '../common/cache/cache.service';
import { setCacheService } from './routers/dashboard.router';
import { ReportsModule } from '../reports/reports.module';
import { ReportsService } from '../reports/reports.service';
import { setReportsService } from './routers/reports.router';
import { setRoleTemplatesCacheService, setRoleTemplatesService } from './routers/role-templates.router';
import { RoleTemplatesService } from '../permissions/role-templates.service';
import { setPermissionsCacheService, setPermissionsDb } from './routers/permissions.router';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { OnboardingService } from '../onboarding/onboarding.service';
import { setOnboardingService } from './routers/onboarding.router';
import { setSettingsCacheService } from './routers/settings.router';

@Module({
  imports: [
    DatabaseModule,
    OrdersModule, UsersModule, ProductsModule, InventoryModule,
    LogisticsModule, MarketingModule, FinanceModule, HrModule,
    NotificationsModule, AuditModule, VoipModule, SettingsModule, CartModule,
    PermissionsModule, PermissionRequestsModule,
    AuthModule,
    BranchesModule,
    CacheModule,
    ReportsModule,
    OnboardingModule,
  ],
  providers: [TrpcMiddleware],
})
export class TrpcModule implements NestModule, OnModuleInit {
  constructor(
    private readonly permissionRequestsService: PermissionRequestsService,
    private readonly ordersService: OrdersService,
    private readonly usersService: UsersService,
    private readonly productsService: ProductsService,
    private readonly productCategoriesService: ProductCategoriesService,
    private readonly inventoryService: InventoryService,
    private readonly shipmentsService: ShipmentsService,
    private readonly logisticsService: LogisticsService,
    private readonly marketingService: MarketingService,
    private readonly financeService: FinanceService,
    private readonly hrService: HrService,
    private readonly payrollBatchService: PayrollBatchService,
    private readonly notificationsService: NotificationsService,
    private readonly pushSchedulerService: PushSchedulerService,
    private readonly auditService: AuditService,
    private readonly voipService: VoipService,
    private readonly settingsService: SettingsService,
    private readonly cartService: CartService,
    private readonly sessionStore: SessionStoreService,
    private readonly cacheService: CacheService,
    private readonly reportsService: ReportsService,
    private readonly branchTeamsService: BranchTeamsService,
    private readonly roleTemplatesService: RoleTemplatesService,
    private readonly onboardingService: OnboardingService,
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  onModuleInit() {
    // Inject NestJS service instances into tRPC routers
    setPermissionRequestsService(this.permissionRequestsService);
    setOrdersService(this.ordersService);
    setOrdersCacheService(this.cacheService);
    setUsersService(this.usersService);
    setUsersSessionStore(this.sessionStore);
    setUsersCacheService(this.cacheService);
    setProductsService(this.productsService);
    setProductsCacheService(this.cacheService);
    setProductCategoriesService(this.productCategoriesService);
    setInventoryService(this.inventoryService);
    setShipmentsService(this.shipmentsService);
    setLogisticsServiceForInventory(this.logisticsService);
    setLogisticsService(this.logisticsService);
    setLogisticsCacheService(this.cacheService);
    setMarketingService(this.marketingService);
    setFinanceService(this.financeService);
    setHrService(this.hrService);
    setPayrollBatchService(this.payrollBatchService);
    setNotificationsService(this.notificationsService);
    setPushSchedulerService(this.pushSchedulerService);
    setAuditService(this.auditService);
    setAuditCacheService(this.cacheService);
    setAuditCacheService(this.cacheService);
    setVoipService(this.voipService);
    setVoipServiceForRouter(this.voipService);
    setSettingsService(this.settingsService);
    setSettingsDb(this.db as Parameters<typeof setSettingsDb>[0]);
    setSettingsCacheService(this.cacheService);
    setCartService(this.cartService);
    setBranchesDb(this.db as Parameters<typeof setBranchesDb>[0]);
    setBranchesCacheService(this.cacheService);
    setBranchTeamsService(this.branchTeamsService);
    setBranchesSessionStore(this.sessionStore);
    setBranchesNotificationsService(this.notificationsService);
    setBranchesSettingsService(this.settingsService);
    setMessagingDb(this.db as Parameters<typeof setMessagingDb>[0]);
    setMessagingCacheService(this.cacheService);
    setDashboardServices({
      orders: this.ordersService,
      finance: this.financeService,
      marketing: this.marketingService,
      hr: this.hrService,
      inventory: this.inventoryService,
    });
    setCacheService(this.cacheService);
    setReportsService(this.reportsService);
    setRoleTemplatesService(this.roleTemplatesService);
    setRoleTemplatesCacheService(this.cacheService);
    setPermissionsDb(this.db as Parameters<typeof setPermissionsDb>[0]);
    setPermissionsCacheService(this.cacheService);
    setOnboardingService(this.onboardingService);
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TrpcMiddleware).forRoutes('/trpc');
  }
}
