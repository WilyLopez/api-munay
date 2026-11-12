import { Module } from '@nestjs/common';
import { AutenticacionModule } from '../autenticacion/autenticacion.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { DestinosController } from './destinos.controller.js';
import { DestinosService } from './destinos.service.js';

@Module({
  imports: [AutenticacionModule, PrismaModule],
  controllers: [DestinosController],
  providers: [DestinosService],
})
export class DestinosModule {}
