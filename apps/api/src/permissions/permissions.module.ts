import { Module } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { PermissionSnapshotBackfillService } from './permission-snapshot-backfill.service';
import { RoleTemplatesService } from './role-templates.service';

@Module({
  providers: [PermissionsService, RoleTemplatesService, PermissionSnapshotBackfillService],
  exports: [PermissionsService, RoleTemplatesService],
})
export class PermissionsModule {}
