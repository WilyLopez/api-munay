import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { AutenticacionService } from '../autenticacion/autenticacion.service.js';
import { VisitasInvitadasService } from './visitas-invitadas.service.js';
import { VisitasService } from './visitas.service.js';

@Controller('visitas')
export class VisitasController {
  constructor(
    private readonly autenticacion: AutenticacionService,
    private readonly visitas: VisitasService,
    private readonly invitadas: VisitasInvitadasService,
  ) {}

  @Get('pantalla/:slug')
  @Header('Cache-Control', 'no-store')
  pantallaPublica(@Param('slug') slug: string) {
    return this.visitas.consultarPantallaPublica(slug);
  }

  @Get('administracion')
  @Header('Cache-Control', 'private, no-store')
  async listar(@Headers('authorization') autorizacion?: string) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    return this.visitas.listarDestinos(perfil);
  }

  @Post('administracion/:slug/codigo')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async sincronizar(
    @Param('slug') slug: string,
    @Body('renovar') renovar: unknown,
    @Body('codigoId') codigoId: unknown,
    @Headers('authorization') autorizacion?: string,
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    return this.visitas.sincronizar(
      perfil,
      slug,
      renovar === true,
      typeof codigoId === 'string' ? codigoId : undefined,
    );
  }

  @Get('administracion/:slug/historial')
  @Header('Cache-Control', 'private, no-store')
  async historial(
    @Param('slug') slug: string,
    @Query('pagina') pagina: unknown,
    @Headers('authorization') autorizacion?: string,
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    const numero =
      typeof pagina === 'string' && /^\d{1,7}$/.test(pagina)
        ? Number(pagina)
        : 1;
    return this.visitas.historial(perfil, slug, Math.max(1, numero));
  }

  @Get('administracion/:slug/estadisticas')
  @Header('Cache-Control', 'private, no-store')
  async estadisticas(
    @Param('slug') slug: string,
    @Query('meses') meses: string,
    @Headers('authorization') autorizacion?: string,
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    return this.visitas.estadisticas(
      perfil,
      slug,
      meses === '12' ? 12 : meses === '3' ? 3 : 6,
    );
  }

  @Post('invitadas/preparar')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  prepararInvitada(
    @Body() datos: { token?: unknown; codigo?: unknown; destino?: string },
  ) {
    return this.invitadas.preparar(
      datos?.token,
      datos?.codigo,
      typeof datos?.destino === 'string' ? datos.destino : undefined,
    );
  }

  @Post('invitadas/verificar')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  verificarInvitada(
    @Body()
    datos: {
      token?: unknown;
      codigo?: unknown;
      destino?: string;
      ubicacion?: unknown;
    },
  ) {
    return this.invitadas.verificar(
      datos?.token,
      datos?.codigo,
      typeof datos?.destino === 'string' ? datos.destino : undefined,
      datos?.ubicacion,
    );
  }

  @Post('invitadas/estado')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  estadoInvitada(@Body() datos: { token?: unknown; destino?: unknown }) {
    return this.invitadas.estado(datos?.token, datos?.destino);
  }

  @Post('invitadas/reclamar')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async reclamarInvitada(
    @Body('token') token: unknown,
    @Headers('authorization') autorizacion?: string,
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    return this.invitadas.reclamar(token, perfil);
  }

  @Post('verificar')
  @HttpCode(200)
  async verificar(
    @Body('codigo') codigo: unknown,
    @Body('destino') destino: unknown,
    @Body('ubicacion') ubicacion: unknown,
    @Headers('authorization') autorizacion?: string,
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    return this.visitas.verificar(
      perfil,
      codigo,
      typeof destino === 'string' ? destino : undefined,
      ubicacion,
    );
  }

  @Post('verificar/preparar')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async prepararVerificacion(
    @Body('codigo') codigo: unknown,
    @Body('destino') destino: unknown,
    @Headers('authorization') autorizacion?: string,
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    return this.visitas.prepararVerificacion(
      perfil,
      codigo,
      typeof destino === 'string' ? destino : undefined,
    );
  }
}
