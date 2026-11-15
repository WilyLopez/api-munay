import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
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
import { AccesosService } from './accesos.service.js';

function cuerpo(entrada: unknown): Record<string, unknown> {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada))
    throw new BadRequestException('Completa el formulario.');
  return entrada as Record<string, unknown>;
}

@Controller('gestion-accesos')
export class AccesosController {
  constructor(
    private readonly autenticacion: AutenticacionService,
    private readonly accesos: AccesosService,
  ) {}

  private async superAdmin(token?: string) {
    const { perfil } = await this.autenticacion.validarSesion(token);
    if (perfil.rol !== 'SUPER_ADMIN') throw new ForbiddenException();
    return perfil.id;
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async listar(
    @Query('pagina') pagina: string,
    @Query('estado') estado: string,
    @Headers('authorization') token?: string,
  ) {
    await this.superAdmin(token);
    return this.accesos.listar(
      undefined,
      /^[1-9]\d{0,4}$/.test(pagina) ? Number(pagina) : 1,
      estado,
    );
  }

  @Get('mis-solicitudes')
  @Header('Cache-Control', 'private, no-store')
  async propias(@Headers('authorization') token?: string) {
    const { perfil } = await this.autenticacion.validarSesion(token);
    return this.accesos.listar(perfil.id);
  }

  @Post('solicitudes')
  @HttpCode(204)
  async solicitar(
    @Body() entrada: unknown,
    @Headers('authorization') token?: string,
  ) {
    await this.accesos.solicitar(
      await this.autenticacion.identificarSesion(token),
      cuerpo(entrada),
    );
  }

  @Post('invitaciones')
  @Header('Cache-Control', 'private, no-store')
  async invitar(
    @Body() entrada: unknown,
    @Headers('authorization') token?: string,
  ) {
    return this.accesos.invitar(await this.superAdmin(token), cuerpo(entrada));
  }

  @Post('aceptar')
  @HttpCode(204)
  async aceptar(
    @Body('token') invitacion: unknown,
    @Headers('authorization') token?: string,
  ) {
    await this.accesos.aceptar(
      await this.autenticacion.identificarSesion(token),
      invitacion,
    );
  }

  @Put(':id/resolver')
  @HttpCode(204)
  async resolver(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() entrada: unknown,
    @Headers('authorization') token?: string,
  ) {
    await this.accesos.resolver(
      id,
      await this.superAdmin(token),
      cuerpo(entrada),
    );
  }
}
