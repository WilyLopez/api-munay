import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import { AutenticacionService } from '../autenticacion/autenticacion.service.js';
import { ReportesService } from './reportes.service.js';
import { AnalisisRiesgoService } from './analisis-riesgo.service.js';

@Controller('reportes-resenas')
export class ReportesController {
  constructor(
    private readonly autenticacion: AutenticacionService,
    private readonly reportes: ReportesService,
    private readonly analisis: AnalisisRiesgoService,
  ) {}

  @Get('analisis')
  @Header('Cache-Control', 'private, no-store')
  async cola(@Headers('authorization') autorizacion: string, @Query('pagina') pagina = '1', @Query('estado') estado?: string) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    return this.analisis.listar(perfil, /^[1-9]\d{0,3}$/.test(pagina) ? Number(pagina) : 1, estado);
  }

  @Put('analisis/:id/reintentar')
  async reintentar(@Headers('authorization') autorizacion: string, @Param('id', ParseUUIDPipe) id: string) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    return this.analisis.reintentar(perfil, id);
  }

  @Put('resena/:id')
  @HttpCode(204)
  async reportar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('motivo') motivo: unknown,
    @Headers('authorization') autorizacion?: string,
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    await this.reportes.reportar(id, perfil, motivo);
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async listar(
    @Query('estado') estado: string,
    @Query('pagina') pagina: string,
    @Query('origen') origen?: string,
    @Query('destino') destino?: string,
    @Query('nivel') nivel?: string,
    @Headers('authorization') autorizacion?: string,
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    return this.reportes.listar(
      perfil,
      estado === 'revisados',
      /^[1-9]\d{0,4}$/.test(pagina) ? Number(pagina) : 1,
      { origen, destino, nivel },
    );
  }

  @Put(':id/revision')
  @HttpCode(204)
  async revisar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('decision') decision: unknown,
    @Body('motivo') motivo: unknown,
    @Headers('authorization') autorizacion?: string,
  ) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    await this.reportes.revisar(id, perfil, decision, motivo);
  }
}
