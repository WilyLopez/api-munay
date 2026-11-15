import { Module } from '@nestjs/common';
import { AutenticacionModule } from '../autenticacion/autenticacion.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PuntosController } from './puntos.controller.js';
import { PuntosService } from './puntos.service.js';

@Module({
  imports: [AutenticacionModule, PrismaModule],
  controllers: [PuntosController],
  providers: [PuntosService],
  exports: [PuntosService],
})
export class PuntosModule {}
