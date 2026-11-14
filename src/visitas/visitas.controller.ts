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
import { VisitasService } from './visitas.service.js';

@Controller('visitas')
export class VisitasController {
  constructor(
    private readonly autenticacion: AutenticacionService,
    private readonly visitas: VisitasService,
  ) {}

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
    @Headers('authorization') autorizacion?: string,
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    return this.visitas.sincronizar(perfil, slug, renovar === true);
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

  @Post('verificar')
  @HttpCode(200)
  async verificar(
    @Body('codigo') codigo: unknown,
    @Body('destino') destino: unknown,
    @Headers('authorization') autorizacion?: string,
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    return this.visitas.verificar(
      perfil,
      codigo,
      typeof destino === 'string' ? destino : undefined,
    );
  }
}
