import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { AutenticacionService } from '../autenticacion/autenticacion.service.js';
import { UsuariosService, type Filtros } from './usuarios.service.js';

@Controller('superadmin/usuarios')
export class UsuariosController {
  constructor(
    private readonly autenticacion: AutenticacionService,
    private readonly usuarios: UsuariosService,
  ) {}

  private async autorizar(autorizacion?: string) {
    const { perfil } = await this.autenticacion.validarSesion(autorizacion);
    if (perfil.rol !== 'SUPER_ADMIN') throw new ForbiddenException();
    return perfil.id;
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async listar(
    @Query() filtros: Filtros,
    @Headers('authorization') autorizacion?: string,
  ) {
    await this.autorizar(autorizacion);
    return this.usuarios.listar(filtros);
  }

  @Get('destinos')
  @Header('Cache-Control', 'no-store')
  async destinos(@Headers('authorization') autorizacion?: string) {
    await this.autorizar(autorizacion);
    return this.usuarios.destinos();
  }

  @Get('perfil')
  @Header('Cache-Control', 'no-store')
  async perfil(@Headers('authorization') autorizacion?: string) {
    return {
      ...(await this.usuarios.detalle(await this.autorizar(autorizacion))),
      propia: true,
    };
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  async detalle(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') autorizacion?: string,
  ) {
    const actor = await this.autorizar(autorizacion);
    return { ...(await this.usuarios.detalle(id)), propia: actor === id };
  }

  @Patch(':id')
  @HttpCode(204)
  async cambiar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() entrada: unknown,
    @Headers('authorization') autorizacion?: string,
  ) {
    await this.usuarios.cambiar(
      await this.autorizar(autorizacion),
      id,
      entrada,
    );
  }
}
