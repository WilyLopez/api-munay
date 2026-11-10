import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AutenticacionModule } from './autenticacion/autenticacion.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, AutenticacionModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
