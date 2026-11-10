import {
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
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

  @Delete()
  @HttpCode(204)
  cerrar(@Headers('authorization') autorizacion?: string) {
    return this.autenticacion.cerrarSesion(autorizacion);
  }
}
