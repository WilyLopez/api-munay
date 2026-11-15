import { Module } from '@nestjs/common';
import { AutenticacionModule } from '../autenticacion/autenticacion.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AnclajesController } from './anclajes.controller.js';
import { AnclajesService } from './anclajes.service.js';

@Module({
  imports: [AutenticacionModule, PrismaModule],
  controllers: [AnclajesController],
  providers: [AnclajesService],
  exports: [AnclajesService],
})
export class AnclajesModule {}
