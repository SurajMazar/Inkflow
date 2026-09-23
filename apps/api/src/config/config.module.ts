import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { ApiEnv } from '@inkflow/config';
import { AppConfig } from './app-config';

@Global()
@Module({})
export class ConfigModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: AppConfig, useValue: new AppConfig(env) }],
      exports: [AppConfig],
    };
  }
}
