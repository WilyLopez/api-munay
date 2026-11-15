import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import { AutenticacionService } from '../autenticacion/autenticacion.service.js';
import { AnclajesService } from './anclajes.service.js';

@Controller('anclajes-resenas')
export class AnclajesController {
  constructor(
    private readonly autenticacion: AutenticacionService,
    private readonly anclajes: AnclajesService,
  ) {}

  private async verificarAcceso(token?: string) {
    const { perfil } = await this.autenticacion.validarSesion(token);
    if (perfil.rol !== 'SUPER_ADMIN') throw new ForbiddenException();
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async listar(
    @Query('estado') estado: string,
    @Query('buscar') buscar: string,
    @Query('pagina') pagina: string,
    @Headers('authorization') token?: string,
  ) {
    await this.verificarAcceso(token);
    return this.anclajes.listar(
      estado,
      buscar,
      /^[1-9]\d{0,4}$/.test(pagina) ? Number(pagina) : 1,
    );
  }

  @Get('exportar')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async exportar(
    @Query('estado') estado: string,
    @Query('buscar') buscar: string,
    @Headers('authorization') token?: string,
  ) {
    await this.verificarAcceso(token);
    return new StreamableFile(
      Readable.from(this.anclajes.exportar(estado, buscar)),
      {
        type: 'text/csv; charset=utf-8',
        disposition: 'attachment; filename="munay-auditoria-blockchain.csv"',
      },
    );
  }

  @Get(':id/verificar')
  @Header('Cache-Control', 'no-store')
  verificarPublico(@Param('id', ParseUUIDPipe) id: string) {
    return this.anclajes.verificarPublico(id);
  }

  @Put(':id/reintentar')
  @HttpCode(204)
  async reintentar(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') token?: string,
  ) {
    await this.verificarAcceso(token);
    await this.anclajes.reintentar(id);
  }
}
