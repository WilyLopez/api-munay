import {
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { AutenticacionService } from '../autenticacion/autenticacion.service.js';
import { DestinosService } from './destinos.service.js';

@Controller('destinos')
export class DestinosController {
  constructor(
    private readonly autenticacion: AutenticacionService,
    private readonly destinos: DestinosService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async listar(@Headers('authorization') autorizacion?: string) {
    const sesion = autorizacion
      ? await this.autenticacion.validarSesion(autorizacion)
      : null;
    return { sesion, destinos: await this.destinos.listar(sesion?.perfil.id) };
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
