import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
} from '@nestjs/common';
import { AutenticacionService } from '../autenticacion/autenticacion.service.js';
import { PuntosService } from './puntos.service.js';

@Controller('puntos')
export class PuntosController {
  constructor(
    private readonly autenticacion: AutenticacionService,
    private readonly puntos: PuntosService,
  ) {}

  @Get('mi-resumen')
  @Header('Cache-Control', 'private, no-store')
  async miResumen(@Headers('authorization') autorizacion?: string) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    if (perfil.rol !== 'TURISTA') throw new ForbiddenException();
    return {
      nombre: perfil.nombreCompleto,
      ...(await this.puntos.resumen(perfil.id)),
    };
  }
}
