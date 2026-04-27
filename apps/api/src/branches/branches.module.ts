import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { BranchTeamsService } from './branch-teams.service';

@Module({
  imports: [DatabaseModule],
  providers: [BranchTeamsService],
  exports: [BranchTeamsService],
})
export class BranchesModule {}
