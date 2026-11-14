import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { AutenticacionService } from '../autenticacion/autenticacion.service.js';
import { ResenasService } from './resenas.service.js';

@Controller('resenas')
export class ResenasController {
  constructor(
    private readonly autenticacion: AutenticacionService,
    private readonly resenas: ResenasService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async listar(
    @Query('destino') slug?: string,
    @Query('orden') orden?: string,
    @Query('pagina') pagina?: string,
    @Headers('authorization') autorizacion?: string,
  ) {
    const sesion = autorizacion
      ? await this.autenticacion.validarSesion(autorizacion)
      : null;
    return this.resenas.listar(
      slug,
      orden,
      pagina && /^[1-9]\d{0,4}$/.test(pagina) ? Number(pagina) : 1,
      sesion?.perfil,
    );
  }

  @Post(':slug')
  async publicar(
    @Param('slug') slug: string,
    @Body('calificacion') calificacion: unknown,
    @Body('comentario') comentario: unknown,
    @Headers('authorization') autorizacion?: string,
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    return this.resenas.publicar(slug, perfil, calificacion, comentario);
  }

  @Put(':id/util')
  @HttpCode(204)
  async marcar(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') autorizacion?: string,
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    await this.resenas.votar(id, perfil.id, true);
  }

  @Delete(':id/util')
  @HttpCode(204)
  async quitar(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') autorizacion?: string,
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    await this.resenas.votar(id, perfil.id, false);
  }
}
