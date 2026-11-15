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
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AutenticacionService } from '../autenticacion/autenticacion.service.js';
import { ResenasService } from './resenas.service.js';

@Controller('resenas')
export class ResenasController {
  constructor(
    private readonly autenticacion: AutenticacionService,
    private readonly resenas: ResenasService,
  ) {}

  @Get('sentimiento/:slug')
  @Header(
    'Cache-Control',
    'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
  )
  resumenSentimiento(@Param('slug') slug: string) {
    return this.resenas.resumenSentimiento(slug);
  }

  @Get()
  async listar(
    @Res({ passthrough: true }) res: Response,
    @Query('destino') slug?: string,
    @Query('orden') orden?: string,
    @Query('pagina') pagina?: string,
    @Headers('authorization') autorizacion?: string,
  ) {
    if (autorizacion) {
      res.setHeader('Cache-Control', 'private, no-store');
    } else {
      res.setHeader(
        'Cache-Control',
        'public, max-age=30, s-maxage=30, stale-while-revalidate=120',
      );
    }
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
