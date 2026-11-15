import { Module } from '@nestjs/common';
import { AutenticacionModule } from '../autenticacion/autenticacion.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PuntosModule } from '../puntos/puntos.module.js';
import { ResenasController } from './resenas.controller.js';
import { ResenasService } from './resenas.service.js';
import { ReportesController } from './reportes.controller.js';
import { ReportesService } from './reportes.service.js';

@Module({
  imports: [AutenticacionModule, PrismaModule, PuntosModule],
  controllers: [ResenasController, ReportesController],
  providers: [ResenasService, ReportesService],
})
export class ResenasModule {}
