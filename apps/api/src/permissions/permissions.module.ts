import { Module } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { RoleTemplatesService } from './role-templates.service';

@Module({
  providers: [PermissionsService, RoleTemplatesService],
  exports: [PermissionsService, RoleTemplatesService],
})
export class PermissionsModule {}
