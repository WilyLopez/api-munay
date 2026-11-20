import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ServicioPrisma } from '../prisma/prisma.service.js';
import { PuntosService } from '../puntos/puntos.service.js';
import { detectarRiesgo, informacionDetector } from './detector-riesgo.js';
import type { PerfilConRol } from '../autenticacion/alcance-administrador.js';
import type { Prisma } from '../generated/prisma/client.js';

type Trabajo = { resenaId: string; intentos: number; token: string };
export const MAX_INTENTOS_RIESGO = 5;
export function proximoIntentoRiesgo(intentos: number, ahora = new Date()) {
  return new Date(
    ahora.getTime() +
      Math.min(30 * 60, 30 * 2 ** Math.max(0, intentos - 1)) * 1000,
  );
}

@Injectable()
export class AnalisisRiesgoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalisisRiesgoService.name);
  private reloj?: ReturnType<typeof setInterval>;
  private ocupado = false;
  constructor(
    private readonly prisma: ServicioPrisma,
    private readonly puntos: PuntosService,
  ) {}
  onModuleInit() {
    if (process.env.VERCEL === '1') return;
    this.reloj = setInterval(() => this.notificar(), 15000);
    this.reloj.unref();
    this.notificar();
  }
  onModuleDestroy() {
    clearInterval(this.reloj);
  }
  notificar() {
    void this.procesar().catch(() =>
      this.logger.warn('La cola de análisis conserva trabajos pendientes.'),
    );
  }

  async procesar(limite = 10) {
    if (this.ocupado) return { procesados: 0, fallidos: 0 };
    this.ocupado = true;
    let procesados = 0,
      fallidos = 0;
    try {
      await this.prisma.cliente.$executeRaw`
        UPDATE munay.analisis_riesgo SET estado = 'fallido', token = NULL, bloqueado_hasta = NULL,
          error = 'El análisis se interrumpió. Revisa el servicio y reintenta desde el panel.', actualizado_en = now()
        WHERE estado = 'procesando' AND bloqueado_hasta < now() AND intentos >= ${MAX_INTENTOS_RIESGO}`;
      for (let i = 0; i < Math.min(50, Math.max(1, limite)); i++) {
        const token = randomUUID();
        const [trabajo] = await this.prisma.cliente.$queryRaw<Trabajo[]>`
          WITH siguiente AS (
            SELECT resena_id FROM munay.analisis_riesgo
            WHERE intentos < ${MAX_INTENTOS_RIESGO} AND (
              (estado IN ('pendiente','fallido') AND proximo_intento_en <= now()) OR
              (estado = 'procesando' AND bloqueado_hasta < now())
            ) ORDER BY creado_en, resena_id FOR UPDATE SKIP LOCKED LIMIT 1
          ) UPDATE munay.analisis_riesgo a SET estado = 'procesando', intentos = a.intentos + 1,
              bloqueado_hasta = now() + interval '2 minutes', token = ${token}::uuid, error = NULL, actualizado_en = now()
            FROM siguiente s WHERE a.resena_id = s.resena_id
            RETURNING a.resena_id AS "resenaId", a.intentos, a.token`;
        if (!trabajo) break;
        try {
          if (await this.analizar(trabajo)) procesados++;
        } catch {
          fallidos++;
          await this.prisma.cliente.analisisRiesgo.updateMany({
            where: {
              resenaId: trabajo.resenaId,
              estado: 'procesando',
              token: trabajo.token,
            },
            data: {
              estado: 'fallido',
              token: null,
              bloqueadoHasta: null,
              proximoIntentoEn: proximoIntentoRiesgo(trabajo.intentos),
              error:
                trabajo.intentos >= MAX_INTENTOS_RIESGO
                  ? 'No se pudo completar el análisis. Revisa el servicio y solicita un reintento.'
                  : 'No se pudo completar el análisis. La reseña está guardada y se reintentará automáticamente.',
            },
          });
        }
      }
      return { procesados, fallidos };
    } finally {
      this.ocupado = false;
    }
  }

  async analizar(trabajo: Trabajo) {
    const origen = await this.prisma.cliente.resena.findUnique({
      where: { id: trabajo.resenaId },
      select: {
        usuarioId: true,
        comentario: true,
        creadaEn: true,
        retiradaEn: true,
      },
    });
    if (!origen) return false;
    const recientes = origen.retiradaEn
      ? []
      : await this.prisma.cliente.resena.findMany({
          where: {
            usuarioId: origen.usuarioId,
            creadaEn: {
              gte: new Date(origen.creadaEn.getTime() - 86400000),
              lte: origen.creadaEn,
            },
            OR: [
              { creadaEn: { lt: origen.creadaEn } },
              { creadaEn: origen.creadaEn, id: { lt: trabajo.resenaId } },
            ],
          },
          orderBy: [{ creadaEn: 'desc' }, { id: 'desc' }],
          take: 20,
          select: { comentario: true, creadaEn: true },
        });
    const analisis = origen.retiradaEn
      ? null
      : detectarRiesgo(origen.comentario, recientes, origen.creadaEn);
    const completado = await this.prisma.cliente.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM munay.resenas WHERE id = ${trabajo.resenaId}::uuid FOR NO KEY UPDATE`;
        await tx.$queryRaw`SELECT resena_id FROM munay.analisis_riesgo WHERE resena_id = ${trabajo.resenaId}::uuid FOR UPDATE`;
        const fila = await tx.analisisRiesgo.findUnique({
          where: { resenaId: trabajo.resenaId },
        });
        if (
          !fila ||
          fila.estado !== 'procesando' ||
          fila.token !== trabajo.token
        )
          return false;
        const resena = await tx.resena.findUnique({
          where: { id: trabajo.resenaId },
          select: {
            retiradaEn: true,
            visitaId: true,
            reportes: {
              where: { revisadoEn: { not: null } },
              orderBy: { revisadoEn: 'desc' },
              take: 1,
              select: { decision: true },
            },
          },
        });
        if (!resena) return false;
        const revisionHumana = resena.reportes[0]?.decision;
        const retirada = Boolean(
          resena.retiradaEn || revisionHumana === 'retirar',
        );
        if (analisis && !retirada) {
          await tx.resena.update({
            where: { id: trabajo.resenaId },
            data: {
              riesgo: analisis.riesgo,
              puntosPendientes:
                Boolean(resena.visitaId) &&
                (!analisis.sospechosa || revisionHumana === 'mantener'),
            },
          });
          if (analisis.sospechosa && !revisionHumana) {
            const alerta = await tx.reporteResena.findFirst({
              where: { resenaId: trabajo.resenaId, reportadaPor: null },
              select: { id: true },
            });
            if (!alerta)
              await tx.reporteResena.create({
                data: {
                  resenaId: trabajo.resenaId,
                  riesgo: analisis.riesgo,
                  motivo: analisis.motivo,
                },
              });
          }
        } else
          await tx.resena.update({
            where: { id: trabajo.resenaId },
            data: { puntosPendientes: false },
          });
        await tx.analisisRiesgo.update({
          where: { resenaId: trabajo.resenaId },
          data: {
            estado: 'completado',
            token: null,
            bloqueadoHasta: null,
            error: null,
            modelo: retirada ? 'omitido-reseña-retirada' : analisis?.modelo,
            puntajeModelo: analisis?.puntajeModelo ?? null,
            puntajeReglas: analisis?.puntajeReglas ?? null,
            senales: analisis?.senales ?? [],
          },
        });
        return true;
      },
      { timeout: 15000 },
    );
    if (completado)
      await this.puntos
        .acreditar(trabajo.resenaId)
        .catch(() =>
          this.logger.warn(
            'Quedó una recompensa pendiente después del análisis.',
          ),
        );
    return completado;
  }

  async listar(perfil: PerfilConRol, pagina: number, estado?: string) {
    this.superadmin(perfil);
    const where: Prisma.AnalisisRiesgoWhereInput = [
      'pendiente',
      'procesando',
      'fallido',
      'completado',
    ].includes(estado ?? '')
      ? { estado }
      : { estado: { not: 'completado' } };
    const [filas, pendientes, fallidos, completados] = await Promise.all([
      this.prisma.cliente.analisisRiesgo.findMany({
        where,
        orderBy: [{ creadoEn: 'asc' }, { resenaId: 'asc' }],
        skip: (pagina - 1) * 20,
        take: 21,
        select: {
          resenaId: true,
          estado: true,
          intentos: true,
          proximoIntentoEn: true,
          actualizadoEn: true,
          error: true,
          modelo: true,
          puntajeModelo: true,
          puntajeReglas: true,
          senales: true,
          resena: {
            select: {
              comentario: true,
              creadaEn: true,
              calificacion: true,
              retiradaEn: true,
              destino: { select: { nombre: true } },
              usuario: { select: { id: true, nombreCompleto: true } },
            },
          },
        },
      }),
      this.prisma.cliente.analisisRiesgo.count({
        where: { estado: { in: ['pendiente', 'procesando'] } },
      }),
      this.prisma.cliente.analisisRiesgo.count({
        where: { estado: 'fallido' },
      }),
      this.prisma.cliente.analisisRiesgo.count({
        where: { estado: 'completado' },
      }),
    ]);
    return {
      trabajos: filas.slice(0, 20),
      hayMas: filas.length > 20,
      pendientes,
      fallidos,
      completados,
      detector: informacionDetector,
    };
  }

  async reintentar(perfil: PerfilConRol, resenaId: string) {
    this.superadmin(perfil);
    const trabajo = await this.prisma.cliente.analisisRiesgo.findUnique({
      where: { resenaId },
    });
    if (!trabajo)
      throw new NotFoundException('El análisis no está disponible.');
    const cambio = await this.prisma.cliente.analisisRiesgo.updateMany({
      where: { resenaId, estado: { in: ['pendiente', 'fallido'] } },
      data: {
        estado: 'pendiente',
        intentos: 0,
        error: null,
        token: null,
        bloqueadoHasta: null,
        proximoIntentoEn: new Date(),
      },
    });
    if (!cambio.count)
      throw new ConflictException(
        'Este análisis ya terminó o está siendo procesado. Actualiza la pantalla.',
      );
    this.notificar();
    return { estado: 'pendiente' };
  }
  private superadmin(perfil: PerfilConRol) {
    if (perfil.rol !== 'SUPER_ADMIN') throw new ForbiddenException();
  }
}
