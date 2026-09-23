import { Global, Module } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { TokensService } from './tokens.service';

/** Token and session primitives, shared by the HTTP guards and the WebSocket gateway. */
@Global()
@Module({ providers: [TokensService, SessionsService], exports: [TokensService, SessionsService] })
export class SecurityModule {}
