import { Global, Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { PurgeService } from './purge.service';

@Global()
@Module({ controllers: [FilesController], providers: [FilesService, PurgeService], exports: [FilesService, PurgeService] })
export class FilesModule {}
