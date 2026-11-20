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
import { RespuestasService } from './respuestas.service.js';
import type { Response } from 'express';
import { AutenticacionService } from '../autenticacion/autenticacion.service.js';
import { ResenasService } from './resenas.service.js';

@Controller('resenas')
export class ResenasController {
  constructor(
    private readonly autenticacion: AutenticacionService,
    private readonly resenas: ResenasService,
    private readonly respuestas: RespuestasService,
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
    @Query('estrellas') estrellas?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('foto') foto?: string,
    @Query('respuesta') respuesta?: string,
    @Query('administracion') administracion?: string,
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
      { estrellas, desde, hasta, foto, respuesta, administracion },
    );
  }

  @Get('escribir/:slug')
  @Header('Cache-Control', 'private, no-store')
  async prepararPublicacion(
    @Param('slug') slug: string,
    @Headers('authorization') autorizacion?: string,
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    return this.resenas.prepararPublicacion(slug, perfil);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  async obtener(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') autorizacion?: string,
  ) {
    const sesion = autorizacion
      ? await this.autenticacion.validarSesion(autorizacion)
      : null;
    return this.resenas.obtener(id, sesion?.perfil.id);
  }

  @Post(':slug')
  async publicar(
    @Param('slug') slug: string,
    @Body('calificacion') calificacion: unknown,
    @Body('comentario') comentario: unknown,
    @Body('solicitudId') solicitudId: unknown,
    @Body('fotoArchivo') foto: unknown,
    @Body('selfieDeclarada') selfie: unknown,
    @Body('consentimientoFoto') consentimientoFoto: unknown,
    @Headers('authorization') autorizacion?: string,
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    return this.resenas.publicar(
      slug,
      perfil,
      calificacion,
      comentario,
      solicitudId,
      foto,
      selfie,
      consentimientoFoto,
    );
  }

  @Get(':id/respuestas')
  @Header('Cache-Control', 'private, no-store')
  async listarRespuestas(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('pagina') pagina?: string,
    @Headers('authorization') autorizacion?: string,
  ) {
    const sesion = autorizacion
      ? await this.autenticacion.validarSesion(autorizacion)
      : null;
    return this.respuestas.listar(
      id,
      pagina && /^[1-9]\d{0,3}$/.test(pagina) ? Number(pagina) : 1,
      sesion?.perfil,
    );
  }

  @Post(':id/respuestas')
  async responder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('comentario') comentario: unknown,
    @Body('solicitudId') solicitudId: unknown,
    @Headers('authorization') autorizacion?: string,
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    return this.respuestas.publicar(id, perfil, comentario, solicitudId);
  }

  @Delete('respuestas/:id')
  @HttpCode(204)
  async retirarRespuesta(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') autorizacion?: string,
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    await this.respuestas.retirar(id, perfil);
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
