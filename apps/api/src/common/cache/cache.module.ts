import { Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
