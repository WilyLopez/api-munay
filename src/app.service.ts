import { Injectable } from '@nestjs/common';
import { ServicioPrisma } from './prisma/prisma.service.js';

export type EstadoSalud = {
  estado: 'ok' | 'degradado';
  horaServidor: string;
  tiempoActivoSegundos: number;
  baseDatos: {
    conectada: boolean;
    latenciaMs?: number;
    error?: string;
  };
  servicios: {
    supabase: boolean;
    blockchainRpc: boolean;
    perspectivaIa: boolean;
  };
  memoriaMb: {
    rss: number;
    heapUsado: number;
  };
};

@Injectable()
export class AppService {
  constructor(private readonly prisma: ServicioPrisma) {}

  getHello(): string {
    return 'Munay API';
  }

  async verificarSalud(): Promise<EstadoSalud> {
    const inicio = performance.now();
    let bdConectada = false;
    let latenciaMs: number | undefined;
    let bdError: string | undefined;

    try {
      await this.prisma.cliente.$queryRaw`SELECT 1`;
      bdConectada = true;
      latenciaMs = Math.round(performance.now() - inicio);
    } catch (err: unknown) {
      bdConectada = false;
      bdError =
        err instanceof Error
          ? err.message
          : 'Error desconocido al consultar base de datos';
    }

    const memoria = process.memoryUsage();

    return {
      estado: bdConectada ? 'ok' : 'degradado',
      horaServidor: new Date().toISOString(),
      tiempoActivoSegundos: Math.floor(process.uptime()),
      baseDatos: {
        conectada: bdConectada,
        latenciaMs,
        error: bdError,
      },
      servicios: {
        supabase: Boolean(
          process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
        ),
        blockchainRpc: Boolean(
          process.env.RPC_URL_SEPOLIA || process.env.SEPOLIA_RPC_URL,
        ),
        perspectivaIa: Boolean(process.env.PERSPECTIVE_API_KEY),
      },
      memoriaMb: {
        rss: Math.round(memoria.rss / (1024 * 1024)),
        heapUsado: Math.round(memoria.heapUsed / (1024 * 1024)),
      },
    };
  }
}
