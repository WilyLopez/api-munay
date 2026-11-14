import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AutenticacionModule } from './autenticacion/autenticacion.module.js';
import { DestinosModule } from './destinos/destinos.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { VisitasModule } from './visitas/visitas.module.js';
import { ResenasModule } from './resenas/resenas.module.js';

@Module({
  imports: [
    PrismaModule,
    AutenticacionModule,
    DestinosModule,
    VisitasModule,
    ResenasModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
