import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AutenticacionModule } from '../autenticacion/autenticacion.module.js';
import { BeneficiosService } from './beneficios.service.js';
import { BeneficiosController } from './beneficios.controller.js';

@Module({
  imports: [PrismaModule, AutenticacionModule],
  providers: [BeneficiosService],
  controllers: [BeneficiosController],
})
export class BeneficiosModule {}
