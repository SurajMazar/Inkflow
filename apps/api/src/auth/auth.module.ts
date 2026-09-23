import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OAuthService } from './oauth.service';

/** Routes of `/auth`. Token/session primitives live in the global `SecurityModule`. */
@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService, OAuthService],
})
export class AuthModule {}
