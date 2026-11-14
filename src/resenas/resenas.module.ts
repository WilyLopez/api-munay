import { Module } from '@nestjs/common';
import { AutenticacionModule } from '../autenticacion/autenticacion.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ResenasController } from './resenas.controller.js';
import { ResenasService } from './resenas.service.js';

@Module({
  imports: [AutenticacionModule, PrismaModule],
  controllers: [ResenasController],
  providers: [ResenasService],
})
export class ResenasModule {}
