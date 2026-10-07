import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { DuplicateRulesService } from './duplicate-rules.service';

@Module({
  providers: [SettingsService, DuplicateRulesService],
  exports: [SettingsService, DuplicateRulesService],
})
export class SettingsModule {}
