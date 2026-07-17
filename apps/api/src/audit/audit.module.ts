import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { ImportHistoryService } from './import-history.service';
import { CacheModule } from '../common/cache/cache.module';

@Module({
  imports: [CacheModule],
  providers: [AuditService, ImportHistoryService],
  exports: [AuditService, ImportHistoryService],
})
export class AuditModule {}
