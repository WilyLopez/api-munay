import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Patch,
  Post,
} from '@nestjs/common';
import { AutenticacionService } from './autenticacion.service.js';

@Controller('autenticacion/sesion')
export class AutenticacionController {
  constructor(private readonly autenticacion: AutenticacionService) {}

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  iniciar(@Headers('authorization') autorizacion?: string) {
    return this.autenticacion.iniciarSesion(autorizacion);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  consultar(@Headers('authorization') autorizacion?: string) {
    return this.autenticacion.validarSesion(autorizacion);
  }

  @Get('perfil-admin')
  @Header('Cache-Control', 'private, no-store')
  consultarPerfilAdmin(@Headers('authorization') autorizacion?: string) {
    return this.autenticacion.consultarPerfilAdmin(autorizacion);
  }

  @Patch('perfil-admin')
  @HttpCode(204)
  async actualizarPerfilAdmin(
    @Body('nombreCompleto') nombre: unknown,
    @Headers('authorization') autorizacion?: string,
  ) {
    await this.autenticacion.actualizarPerfilAdmin(autorizacion, nombre);
  }

  @Patch('perfil-visitante')
  @HttpCode(204)
  async actualizarPerfilVisitante(
    @Body('nombreCompleto') nombre: unknown,
    @Headers('authorization') autorizacion?: string,
  ) {
    await this.autenticacion.actualizarPerfilVisitante(autorizacion, nombre);
  }

  @Delete()
  @HttpCode(204)
  cerrar(@Headers('authorization') autorizacion?: string) {
    return this.autenticacion.cerrarSesion(autorizacion);
  }
}
