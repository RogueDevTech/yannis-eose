import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { CacheModule } from '../common/cache/cache.module';

@Module({
  imports: [CacheModule],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
