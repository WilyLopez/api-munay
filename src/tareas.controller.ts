import {
  Controller,
  Get,
  Header,
  Headers,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { AnclajesService } from './blockchain/anclajes.service.js';
import { PuntosService } from './puntos/puntos.service.js';
import { AnalisisRiesgoService } from './resenas/analisis-riesgo.service.js';

@Controller('interno/tareas')
export class TareasController {
  constructor(
    private readonly puntos: PuntosService,
    private readonly anclajes: AnclajesService,
    private readonly riesgo: AnalisisRiesgoService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async ejecutar(@Headers('authorization') autorizacion?: string) {
    const secreto = process.env.CRON_SECRET;
    if (!secreto || !autorizacion) throw new UnauthorizedException();
    const esperado = Buffer.from(`Bearer ${secreto}`);
    const recibido = Buffer.from(autorizacion);
    if (
      recibido.length !== esperado.length ||
      !timingSafeEqual(recibido, esperado)
    ) {
      throw new UnauthorizedException();
    }
    const analisis = await this.riesgo.procesar();
    const [puntos, blockchain] = await Promise.allSettled([
      this.puntos.acreditar(),
      this.anclajes.procesar(),
    ]);
    if (
      puntos.status === 'rejected' ||
      blockchain.status === 'rejected' ||
      blockchain.value === 'error'
    ) {
      throw new ServiceUnavailableException(
        'Quedaron tareas pendientes de procesar.',
      );
    }
    return { puntos: 'procesado', blockchain: blockchain.value, analisis };
  }
}
