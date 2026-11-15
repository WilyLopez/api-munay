import { Module } from '@nestjs/common';
import { AutenticacionModule } from '../autenticacion/autenticacion.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AccesosController } from './accesos.controller.js';
import { AccesosService } from './accesos.service.js';

@Module({
  imports: [AutenticacionModule, PrismaModule],
  controllers: [AccesosController],
  providers: [AccesosService],
})
export class AccesosModule {}
