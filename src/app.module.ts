import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AutenticacionModule } from './autenticacion/autenticacion.module.js';
import { DestinosModule } from './destinos/destinos.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { VisitasModule } from './visitas/visitas.module.js';
import { ResenasModule } from './resenas/resenas.module.js';
import { UsuariosModule } from './usuarios/usuarios.module.js';
import { AnclajesModule } from './blockchain/anclajes.module.js';
import { PuntosModule } from './puntos/puntos.module.js';
import { TareasController } from './tareas.controller.js';
import { AccesosModule } from './accesos/accesos.module.js';
import { BeneficiosModule } from './beneficios/beneficios.module.js';

@Module({
  imports: [
    PrismaModule,
    AutenticacionModule,
    DestinosModule,
    VisitasModule,
    ResenasModule,
    UsuariosModule,
    AnclajesModule,
    PuntosModule,
    AccesosModule,
    BeneficiosModule,
  ],
  controllers: [AppController, TareasController],
  providers: [AppService],
})
export class AppModule {}
