import { Global, Module } from '@nestjs/common';
import { RealtimeService } from '../collaboration/realtime.service';
import { BoardDocumentService } from '../documents/board-document.service';
import { AccessService } from './access.service';

/** Cross-cutting board services: role resolution, realtime fan-out and element persistence. */
@Global()
@Module({
  providers: [AccessService, RealtimeService, BoardDocumentService],
  exports: [AccessService, RealtimeService, BoardDocumentService],
})
export class CoreModule {}
