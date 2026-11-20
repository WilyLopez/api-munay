import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { AutenticacionService } from '../autenticacion/autenticacion.service.js';
import { BeneficiosService } from './beneficios.service.js';

function paginaValida(pagina = '1') {
  if (!/^[1-9]\d{0,3}$/.test(pagina))
    throw new BadRequestException('La página no es válida.');
  return Number(pagina);
}
@Controller('beneficios')
export class BeneficiosController {
  constructor(
    private readonly auth: AutenticacionService,
    private readonly beneficios: BeneficiosService,
  ) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  async listar(
    @Headers('authorization') token?: string,
    @Query('categoria') categoria?: string,
    @Query('destino') destino?: string,
    @Query('orden') orden?: string,
    @Query('pagina') pagina?: string,
  ) {
    const { perfil } = await this.auth.validarSesion(token);
    return this.beneficios.listar(perfil, {
      categoria,
      destino,
      orden,
      pagina: paginaValida(pagina),
    });
  }
  @Get('administracion')
  @Header('Cache-Control', 'private, no-store')
  async administrar(
    @Headers('authorization') token?: string,
    @Query('pagina') pagina?: string,
    @Query('estado') estado?: string,
    @Query('buscar') buscar?: string,
  ) {
    const { perfil } = await this.auth.validarSesion(token);
    return this.beneficios.listar(
      perfil,
      { pagina: paginaValida(pagina), estado, buscar },
      true,
    );
  }
  @Get('administracion/indicadores')
  @Header('Cache-Control', 'private, no-store')
  async indicadores(@Headers('authorization') token: string) {
    const { perfil } = await this.auth.validarSesion(token);
    return this.beneficios.indicadores(perfil);
  }

  @Get('administracion/canjes')
  @Header('Cache-Control', 'private, no-store')
  async recibidos(
    @Headers('authorization') token: string,
    @Query('pagina') pagina?: string,
    @Query('estado') estado?: string,
    @Query('buscar') buscar?: string,
  ) {
    const { perfil } = await this.auth.validarSesion(token);
    return this.beneficios.canjesRecibidos(
      perfil,
      paginaValida(pagina),
      estado,
      buscar,
    );
  }

  @Get('administracion/:id/historial')
  @Header('Cache-Control', 'private, no-store')
  async historial(
    @Headers('authorization') token: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('pagina') pagina?: string,
  ) {
    const { perfil } = await this.auth.validarSesion(token);
    return this.beneficios.historialCambios(perfil, id, paginaValida(pagina));
  }

  @Post('administracion/:id/estado')
  async estado(
    @Headers('authorization') token: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('accion') accion: unknown,
    @Body('revision') revision: unknown,
  ) {
    const { perfil } = await this.auth.validarSesion(token);
    return this.beneficios.cambiarEstado(perfil, id, accion, revision);
  }
  @Post('administracion')
  async crear(@Headers('authorization') token: string, @Body() datos: unknown) {
    const { perfil } = await this.auth.validarSesion(token);
    return this.beneficios.guardar(perfil, datos);
  }
  @Put('administracion/:id')
  async actualizar(
    @Headers('authorization') token: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() datos: unknown,
  ) {
    const { perfil } = await this.auth.validarSesion(token);
    return this.beneficios.guardar(perfil, datos, id);
  }
  @Post('canjear')
  async canjear(
    @Headers('authorization') token: string,
    @Body('beneficioId') beneficioId: unknown,
    @Body('solicitudId') solicitudId: unknown,
    @Body('costo') costo: unknown,
    @Body('version') version: unknown,
  ) {
    const { perfil } = await this.auth.validarSesion(token);
    return this.beneficios.canjear(perfil, beneficioId, solicitudId, {
      costo,
      version,
    });
  }
  @Get('mis-canjes')
  @Header('Cache-Control', 'private, no-store')
  async misCanjes(
    @Headers('authorization') token: string,
    @Query('pagina') pagina?: string,
  ) {
    const { perfil } = await this.auth.validarSesion(token);
    return this.beneficios.misCanjes(perfil, paginaValida(pagina));
  }
  @Post('comprobar')
  async comprobar(
    @Headers('authorization') token: string,
    @Body('codigo') codigo: unknown,
    @Body('confirmar') confirmar: unknown,
  ) {
    const { perfil } = await this.auth.validarSesion(token);
    return this.beneficios.usar(perfil, codigo, confirmar === true);
  }
}
