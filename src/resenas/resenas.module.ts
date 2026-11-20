import { RespuestasService } from './respuestas.service.js';
import { Module } from '@nestjs/common';
import { AutenticacionModule } from '../autenticacion/autenticacion.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PuntosModule } from '../puntos/puntos.module.js';
import { DestinosModule } from '../destinos/destinos.module.js';
import { ResenasController } from './resenas.controller.js';
import { ResenasService } from './resenas.service.js';
import { ReportesController } from './reportes.controller.js';
import { ReportesService } from './reportes.service.js';
import { AnalisisRiesgoService } from './analisis-riesgo.service.js';

@Module({
  imports: [AutenticacionModule, PrismaModule, PuntosModule, DestinosModule],
  controllers: [ResenasController, ReportesController],
  providers: [ResenasService, ReportesService, RespuestasService, AnalisisRiesgoService],
  exports: [AnalisisRiesgoService],
})
export class ResenasModule {}
