import { Module } from '@nestjs/common';
import { OperationsModule } from '../operations/operations.module';
import { CollaborationGateway } from './collaboration.gateway';
import { PresenceService } from './presence.service';

@Module({
  imports: [OperationsModule],
  providers: [CollaborationGateway, PresenceService],
  exports: [CollaborationGateway, PresenceService],
})
export class CollaborationModule {}
