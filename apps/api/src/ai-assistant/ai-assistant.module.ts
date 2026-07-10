import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AiAssistantService } from './ai-assistant.service';

@Module({
  imports: [DatabaseModule],
  providers: [AiAssistantService],
  exports: [AiAssistantService],
})
export class AiAssistantModule {}
