import { Module } from '@nestjs/common';
import { VoipService } from './voip.service';
import { VoipController } from './voip.controller';
import { AfricasTalkingProvider } from './providers/africas-talking.provider';
import { SettingsModule } from '../settings/settings.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [SettingsModule, EventsModule],
  controllers: [VoipController],
  // Africa's Talking is the only registered provider. To add another (e.g. Termii or a
  // self-hosted SIP gateway), implement `VoipProvider`, register it here, and add a case
  // to `VoipService.providerByName()`.
  providers: [VoipService, AfricasTalkingProvider],
  exports: [VoipService],
})
export class VoipModule {}
