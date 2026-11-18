import { VisitasInvitadasService } from './visitas-invitadas.service.js';
import { Module } from '@nestjs/common';
import { AutenticacionModule } from '../autenticacion/autenticacion.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { VisitasController } from './visitas.controller.js';
import { VisitasService } from './visitas.service.js';

@Module({
  imports: [AutenticacionModule, PrismaModule],
  controllers: [VisitasController],
  providers: [VisitasService, VisitasInvitadasService],
})
export class VisitasModule {}
