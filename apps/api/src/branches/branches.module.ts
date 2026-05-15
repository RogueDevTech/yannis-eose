import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CacheModule } from '../common/cache/cache.module';
import { BranchTeamsService } from './branch-teams.service';

@Module({
  imports: [DatabaseModule, CacheModule],
  providers: [BranchTeamsService],
  exports: [BranchTeamsService],
})
export class BranchesModule {}
