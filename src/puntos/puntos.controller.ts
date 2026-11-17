import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  Query,
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
    const perfil = await this.autenticacion.identificarSesion(autorizacion);
    if (perfil.rol !== 'TURISTA') throw new ForbiddenException();
    return {
      nombre: perfil.nombreCompleto,
      correo: perfil.correo,
      rol: perfil.rol,
      ...(await this.puntos.resumen(perfil.id)),
    };
  }

  @Get('mi-historial')
  @Header('Cache-Control', 'private, no-store')
  async miHistorial(
    @Headers('authorization') autorizacion?: string,
    @Query('seccion') seccion = 'visitas',
    @Query('pagina') pagina = '1',
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    if (perfil.rol !== 'TURISTA') throw new ForbiddenException();
    if (
      typeof pagina !== 'string' ||
      !/^[1-9]\d{0,3}$/.test(pagina) ||
      ![
        'visitas',
        'resenas',
        'fotos',
        'respuestas',
        'favoritos',
        'puntos',
      ].includes(seccion)
    ) {
      throw new BadRequestException('La sección o la página no es válida.');
    }
    return this.puntos.historial(
      perfil.id,
      seccion as Parameters<PuntosService['historial']>[1],
      Number(pagina),
    );
  }
}
