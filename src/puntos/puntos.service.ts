import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { ServicioPrisma } from '../prisma/prisma.service.js';

const PUNTOS_RESENA = 10;

@Injectable()
export class PuntosService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PuntosService.name);
  private reloj?: ReturnType<typeof setInterval>;
  private procesando = false;

  constructor(private readonly prisma: ServicioPrisma) {}

  onModuleInit() {
    if (process.env.VERCEL === '1') return;
    this.reloj = setInterval(() => void this.procesarPendientes(), 30000);
    this.reloj.unref();
  }

  onModuleDestroy() {
    clearInterval(this.reloj);
  }

  async saldo(usuarioId: string) {
    const saldo = await this.prisma.cliente.movimientoPuntos.aggregate({
      where: { usuarioId },
      _sum: { puntos: true },
    });
    return saldo._sum.puntos ?? 0;
  }

  async resumen(usuarioId: string) {
    const [resumen] = await this.prisma.cliente.$queryRaw<
      {
        saldo: number;
        posicion: number | null;
        visitas: number;
        resenas: number;
        ranking: {
          nombre: string;
          saldo: number;
          posicion: number;
          propia: boolean;
        }[];
      }[]
    >`
      WITH saldos AS (
        SELECT u.id, split_part(trim(u.nombre_completo), ' ', 1) AS nombre,
          sum(m.puntos)::int AS saldo
        FROM munay.movimientos_puntos m
        JOIN munay.usuarios u ON u.id = m.usuario_id
        WHERE u.activo AND u.rol = 'TURISTA'
        GROUP BY u.id, u.nombre_completo
        HAVING sum(m.puntos) > 0
      ), posiciones AS (
        SELECT *, (dense_rank() OVER (ORDER BY saldo DESC))::int AS posicion,
          id = ${usuarioId}::uuid AS propia
        FROM saldos
      ), primeros AS (
        SELECT id, nombre, saldo, posicion, propia FROM posiciones
        ORDER BY posicion, id LIMIT 10
      )
      SELECT coalesce((SELECT saldo FROM posiciones WHERE propia), 0)::int AS saldo,
        (SELECT posicion FROM posiciones WHERE propia) AS posicion,
        (SELECT count(*)::int FROM munay.visitas_verificadas WHERE usuario_id = ${usuarioId}::uuid) AS visitas,
        (SELECT count(*)::int FROM munay.resenas WHERE usuario_id = ${usuarioId}::uuid AND retirada_en IS NULL) AS resenas,
        coalesce((SELECT jsonb_agg(to_jsonb(p) - 'id' ORDER BY posicion, id) FROM primeros p), '[]'::jsonb) AS ranking`;
    return resumen;
  }

  async historial(
    usuarioId: string,
    seccion: 'visitas' | 'resenas',
    pagina: number,
  ) {
    const limite = 12;
    const paginacion = { skip: (pagina - 1) * limite, take: limite + 1 };
    const destino = { select: { slug: true, nombre: true, ubicacion: true } };
    const where = { usuarioId };
    if (seccion === 'visitas') {
      const filas = await this.prisma.cliente.visitaVerificada.findMany({
        where,
        ...paginacion,
        orderBy: [{ verificadaEn: 'desc' }, { id: 'desc' }],
        select: { id: true, verificadaEn: true, destino },
      });
      return {
        seccion,
        filas: filas.slice(0, limite),
        hayMas: filas.length > limite && pagina < 9999,
      };
    }
    const filas = await this.prisma.cliente.resena.findMany({
      where,
      ...paginacion,
      orderBy: [{ creadaEn: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        creadaEn: true,
        calificacion: true,
        comentario: true,
        retiradaEn: true,
        destino,
      },
    });
    return {
      seccion,
      filas: filas.slice(0, limite),
      hayMas: filas.length > limite && pagina < 9999,
    };
  }

  async acreditar(resenaId?: string) {
    const filtro = resenaId
      ? Prisma.sql`AND r.id = ${resenaId}::uuid`
      : Prisma.empty;
    await this.prisma.cliente.$executeRaw`
      WITH pendientes AS (
        SELECT r.id, r.usuario_id, r.foto_url, r.selfie_declarada FROM munay.resenas r
        WHERE r.puntos_pendientes AND r.visita_id IS NOT NULL AND r.retirada_en IS NULL ${filtro}
        ORDER BY r.creada_en, r.id LIMIT 100 FOR UPDATE OF r SKIP LOCKED
      ), acreditaciones AS (
        INSERT INTO munay.movimientos_puntos (id, usuario_id, resena_id, tipo, puntos)
        SELECT gen_random_uuid(), usuario_id, id, 'acreditacion', ${PUNTOS_RESENA} + CASE WHEN foto_url IS NOT NULL AND selfie_declarada THEN 5 ELSE 0 END
        FROM pendientes
        ON CONFLICT (resena_id, tipo) DO NOTHING
      )
      UPDATE munay.resenas SET puntos_pendientes = FALSE
      WHERE id IN (SELECT id FROM pendientes)`;
  }

  private async procesarPendientes() {
    if (this.procesando) return;
    this.procesando = true;
    try {
      await this.acreditar();
    } catch {
      this.logger.warn('Quedan acreditaciones de puntos por procesar.');
    } finally {
      this.procesando = false;
    }
  }
}

export async function revertirPuntos(
  tx: Prisma.TransactionClient,
  resenaId: string,
) {
  await tx.$executeRaw`
    INSERT INTO munay.movimientos_puntos (id, usuario_id, resena_id, tipo, puntos)
    SELECT gen_random_uuid(), usuario_id, resena_id, 'reversion', -puntos
    FROM munay.movimientos_puntos
    WHERE resena_id = ${resenaId}::uuid AND tipo = 'acreditacion'
    ON CONFLICT (resena_id, tipo) DO NOTHING`;
}
