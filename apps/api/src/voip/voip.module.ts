import { Module } from '@nestjs/common';
import { VoipService } from './voip.service';
import { VoipController } from './voip.controller';
import { SettingsModule } from '../settings/settings.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [SettingsModule, EventsModule],
  controllers: [VoipController],
  providers: [VoipService],
  exports: [VoipService],
})
export class VoipModule {}
