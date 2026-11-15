import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { AutenticacionService } from '../autenticacion/autenticacion.service.js';
import { PuntosService } from '../puntos/puntos.service.js';
import { DestinosService } from './destinos.service.js';

@Controller('destinos')
export class DestinosController {
  constructor(
    private readonly autenticacion: AutenticacionService,
    private readonly destinos: DestinosService,
    private readonly puntos: PuntosService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async listar(@Headers('authorization') autorizacion?: string) {
    const sesion = autorizacion
      ? await this.autenticacion.validarSesion(autorizacion)
      : null;
    const [destinos, saldoPuntos] = await Promise.all([
      this.destinos.listar(sesion?.perfil.id),
      sesion?.perfil.rol === 'TURISTA'
        ? this.puntos.saldo(sesion.perfil.id)
        : null,
    ]);
    return { sesion: sesion && { ...sesion, saldoPuntos }, destinos };
  }

  @Get(':slug')
  @Header('Cache-Control', 'private, no-store')
  async obtener(
    @Param('slug') slug: string,
    @Headers('authorization') autorizacion?: string,
  ) {
    const sesion = autorizacion
      ? await this.autenticacion.validarSesion(autorizacion)
      : null;
    return {
      tieneSesion: Boolean(sesion),
      destino: await this.destinos.obtener(slug, sesion?.perfil.id),
    };
  }

  @Put(':id/orden-portada')
  @HttpCode(204)
  async actualizarOrdenPortada(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('ordenPortada') orden: unknown,
    @Headers('authorization') autorizacion?: string,
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    if (perfil.rol !== 'SUPER_ADMIN') throw new ForbiddenException();
    if (
      orden !== null &&
      (typeof orden !== 'number' ||
        !Number.isInteger(orden) ||
        orden < 1 ||
        orden > 2147483647)
    ) {
      throw new BadRequestException('Indica un orden entero positivo.');
    }
    await this.destinos.actualizarOrdenPortada(id, orden);
  }

  @Get('administracion/:slug/ficha')
  @Header('Cache-Control', 'private, no-store')
  async obtenerFichaOperativa(
    @Param('slug') slug: string,
    @Headers('authorization') autorizacion?: string,
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    return this.destinos.obtenerFichaOperativa(slug, perfil);
  }

  @Put('administracion/:slug/ficha')
  @HttpCode(204)
  async actualizarFichaOperativa(
    @Param('slug') slug: string,
    @Body() entrada: unknown,
    @Headers('authorization') autorizacion?: string,
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    await this.destinos.actualizarFichaOperativa(slug, perfil, entrada);
  }

  @Put(':id/favorito')
  @HttpCode(204)
  async guardarFavorito(
    @Param('id', ParseUUIDPipe) destinoId: string,
    @Headers('authorization') autorizacion?: string,
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    await this.destinos.guardarFavorito(perfil.id, destinoId);
  }

  @Delete(':id/favorito')
  @HttpCode(204)
  async quitarFavorito(
    @Param('id', ParseUUIDPipe) destinoId: string,
    @Headers('authorization') autorizacion?: string,
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    await this.destinos.quitarFavorito(perfil.id, destinoId);
  }
}
