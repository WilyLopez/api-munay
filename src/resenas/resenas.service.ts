import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { huellaResena } from '../blockchain/huella-resena.js';
import { DestinosService } from '../destinos/destinos.service.js';
import type { Prisma, RolUsuario } from '../generated/prisma/client.js';
import { ServicioPrisma } from '../prisma/prisma.service.js';
import { PuntosService } from '../puntos/puntos.service.js';
import { actualizarPromedioResenas } from './promedio-resenas.js';
import { analizarSentimiento } from './sentimiento.js';
import { evaluarRiesgoResena, UMBRAL_RIESGO_RESENA } from './riesgo-resena.js';

export type PerfilResenas = { id: string; rol: RolUsuario };
const TAMANO_PAGINA = 20;

function seleccionarResena(usuarioId?: string) {
  return {
    id: true,
    comentario: true,
    calificacion: true,
    creadaEn: true,
    visitaId: true,
    usuario: { select: { nombreCompleto: true } },
    destino: { select: { nombre: true, slug: true } },
    anclaje: { select: { huella: true, estado: true, transaccion: true } },
    _count: { select: { votos: true } },
    votos: usuarioId
      ? { where: { usuarioId }, select: { usuarioId: true } }
      : false,
  } satisfies Prisma.ResenaSelect;
}

function serializarResena({
  visitaId,
  _count,
  votos,
  anclaje,
  ...fila
}: Prisma.ResenaGetPayload<{ select: ReturnType<typeof seleccionarResena> }>) {
  return {
    ...fila,
    verificada: Boolean(visitaId),
    utiles: _count.votos,
    votoPropio: Boolean(votos?.length),
    integridad:
      anclaje?.estado === 'confirmado'
        ? { huella: anclaje.huella, transaccion: anclaje.transaccion }
        : null,
  };
}

@Injectable()
export class ResenasService {
  private cacheSentimiento = new Map<
    string,
    {
      resumen: {
        total: number;
        positivas: number;
        neutras: number;
        negativas: number;
        temas: string[];
      };
      expiraEn: number;
    }
  >();
  private cacheDestinosListado?: {
    destinos: { nombre: string; slug: string }[];
    expiraEn: number;
  };

  constructor(
    private readonly prisma: ServicioPrisma,
    private readonly puntos: PuntosService,
    private readonly destinos: DestinosService,
  ) {}

  private async obtenerDestinosListado() {
    const ahora = Date.now();
    if (
      this.cacheDestinosListado &&
      this.cacheDestinosListado.expiraEn > ahora
    ) {
      return this.cacheDestinosListado.destinos;
    }
    const destinos = await this.prisma.cliente.destino.findMany({
      where: { estadoEditorial: 'publicada' },
      select: { nombre: true, slug: true },
      orderBy: { nombre: 'asc' },
    });
    this.cacheDestinosListado = { destinos, expiraEn: ahora + 300_000 };
    return destinos;
  }

  async resumenSentimiento(slug: string) {
    const ahora = Date.now();
    const cacheado = this.cacheSentimiento.get(slug);
    if (cacheado && cacheado.expiraEn > ahora) {
      return cacheado.resumen;
    }

    const [resumen] = await this.prisma.cliente.$queryRaw<
      {
        total: number;
        positivas: number;
        neutras: number;
        negativas: number;
        temas: string[];
      }[]
    >`
      WITH visibles AS (
        SELECT r.sentimiento, r.temas
        FROM munay.resenas r
        JOIN munay.destinos d ON d.id = r.destino_id
        WHERE d.slug = ${slug} AND d.estado_editorial = 'publicada' AND r.retirada_en IS NULL
      ), temas_frecuentes AS (
        SELECT tema, count(*) AS frecuencia
        FROM visibles CROSS JOIN LATERAL unnest(temas) AS tema
        WHERE sentimiento IS NOT NULL
        GROUP BY tema ORDER BY frecuencia DESC, tema LIMIT 3
      )
      SELECT count(*)::int AS total,
        (count(*) FILTER (WHERE sentimiento = 'POSITIVA'))::int AS positivas,
        (count(*) FILTER (WHERE sentimiento = 'NEUTRA'))::int AS neutras,
        (count(*) FILTER (WHERE sentimiento = 'NEGATIVA'))::int AS negativas,
        ARRAY(SELECT tema FROM temas_frecuentes ORDER BY frecuencia DESC, tema) AS temas
      FROM visibles`;
    if (resumen) {
      if (this.cacheSentimiento.size > 100) this.cacheSentimiento.clear();
      this.cacheSentimiento.set(slug, { resumen, expiraEn: ahora + 60_000 });
    }
    return resumen;
  }

  async listar(
    slug: string | undefined,
    orden: string | undefined,
    pagina: number,
    perfil?: PerfilResenas,
  ) {
    const cliente = this.prisma.cliente;
    const destino = slug
      ? await cliente.destino.findUnique({
          where: { slug, estadoEditorial: 'publicada' },
          select: { id: true, nombre: true },
        })
      : null;
    if (slug && !destino)
      throw new NotFoundException('El destino no está disponible.');
    const where = {
      retiradaEn: null,
      destino: { estadoEditorial: 'publicada' },
      ...(destino && { destinoId: destino.id }),
    };
    const ordenFecha = [
      { creadaEn: 'desc' },
      { id: 'desc' },
    ] satisfies Prisma.ResenaOrderByWithRelationInput[];
    const [filas, grupos, verificadas, visita, destinos] = await Promise.all([
      cliente.resena.findMany({
        where,
        select: seleccionarResena(perfil?.id),
        orderBy:
          orden === 'calificacion'
            ? [{ calificacion: 'desc' }, ...ordenFecha]
            : ordenFecha,
        skip: (pagina - 1) * TAMANO_PAGINA,
        take: TAMANO_PAGINA + 1,
      }),
      cliente.resena.groupBy({
        by: ['calificacion'],
        where,
        _count: { _all: true },
      }),
      cliente.resena.count({ where: { ...where, visitaId: { not: null } } }),
      destino && perfil?.rol === 'TURISTA'
        ? cliente.visitaVerificada.findUnique({
            where: {
              usuarioId_destinoId: {
                usuarioId: perfil.id,
                destinoId: destino.id,
              },
            },
            select: {
              resena: {
                select: {
                  retiradaEn: true,
                  movimientosPuntos: {
                    where: { tipo: 'acreditacion' },
                    select: { puntos: true, creadoEn: true },
                  },
                },
              },
            },
          })
        : null,
      this.obtenerDestinosListado(),
    ]);
    const total = grupos.reduce((suma, grupo) => suma + grupo._count._all, 0);
    const movimiento = visita?.resena?.movimientosPuntos[0];
    return {
      destinos,
      resenas: filas.slice(0, TAMANO_PAGINA).map(serializarResena),
      hayMas: filas.length > TAMANO_PAGINA,
      total,
      verificadas,
      promedio: total
        ? grupos.reduce(
            (suma, grupo) => suma + grupo.calificacion * grupo._count._all,
            0,
          ) / total
        : null,
      distribucion: grupos.map(({ calificacion, _count }) => ({
        calificacion,
        total: _count._all,
      })),
      recompensa:
        movimiento && !visita?.resena?.retiradaEn && destino
          ? { ...movimiento, destino: destino.nombre }
          : null,
      estado: !perfil
        ? 'visitante'
        : visita?.resena
          ? visita.resena.retiradaEn
            ? 'retirada'
            : 'publicada'
          : visita
            ? 'habilitada'
            : 'bloqueada',
    };
  }

  async obtener(id: string, usuarioId?: string) {
    const resena = await this.prisma.cliente.resena.findUnique({
      where: {
        id,
        retiradaEn: null,
        destino: { estadoEditorial: 'publicada' },
      },
      select: seleccionarResena(usuarioId),
    });
    if (!resena)
      throw new NotFoundException('Esta reseña ya no está disponible.');
    return serializarResena(resena);
  }

  async publicar(
    slug: string,
    perfil: PerfilResenas,
    calificacion: unknown,
    texto: unknown,
    solicitudId?: unknown,
  ) {
    if (perfil.rol !== 'TURISTA')
      throw new ForbiddenException(
        'La publicación requiere una cuenta de turista.',
      );
    if (
      typeof calificacion !== 'number' ||
      !Number.isInteger(calificacion) ||
      calificacion < 1 ||
      calificacion > 5
    ) {
      throw new BadRequestException('Selecciona una calificación entre 1 y 5.');
    }
    const comentario = typeof texto === 'string' ? texto.trim() : '';
    if (
      solicitudId !== undefined &&
      (typeof solicitudId !== 'string' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
          solicitudId,
        ))
    )
      throw new BadRequestException(
        'La solicitud de publicación no es válida.',
      );
    if (!comentario || Array.from(comentario).length > 2000)
      throw new BadRequestException(
        'Escribe un comentario de 1 a 2000 caracteres.',
      );
    const resenaPublicada = await this.prisma.cliente.$transaction(
      async (transaccion) => {
        const destino = await transaccion.destino.findUnique({
          where: { slug, estadoEditorial: 'publicada' },
          select: { id: true },
        });
        if (!destino)
          throw new NotFoundException('El destino no está disponible.');
        await transaccion.$queryRaw`SELECT id FROM munay.destinos WHERE id = ${destino.id}::uuid FOR NO KEY UPDATE`;
        const visita = await transaccion.visitaVerificada.findUnique({
          where: {
            usuarioId_destinoId: {
              usuarioId: perfil.id,
              destinoId: destino.id,
            },
          },
          select: {
            id: true,
            resena: {
              select: {
                id: true,
                calificacion: true,
                comentario: true,
                retiradaEn: true,
              },
            },
          },
        });
        if (!visita)
          throw new ForbiddenException(
            'Verifica tu visita mediante el QR del destino.',
          );
        if (visita.resena) {
          if (
            visita.resena.id === solicitudId &&
            visita.resena.retiradaEn === null &&
            visita.resena.calificacion === calificacion &&
            visita.resena.comentario === comentario
          )
            return { id: visita.resena.id };
          throw new ConflictException(
            'Ya publicaste una reseña para esta visita.',
          );
        }
        await transaccion.$queryRaw`SELECT id FROM munay.usuarios WHERE id = ${perfil.id}::uuid FOR NO KEY UPDATE`;
        const ahora = new Date();
        const recientes = await transaccion.resena.findMany({
          where: {
            usuarioId: perfil.id,
            creadaEn: { gte: new Date(ahora.getTime() - 86400000) },
          },
          orderBy: { creadaEn: 'desc' },
          take: 20,
          select: { comentario: true, creadaEn: true },
        });
        const { riesgo, motivo } = evaluarRiesgoResena(
          comentario,
          recientes,
          ahora,
        );
        const sospechosa = riesgo > UMBRAL_RIESGO_RESENA;
        const id = solicitudId ?? randomUUID();
        const resena = await transaccion.resena.create({
          data: {
            id,
            usuarioId: perfil.id,
            destinoId: destino.id,
            visitaId: visita.id,
            puntosPendientes: !sospechosa,
            riesgo,
            calificacion,
            comentario,
            ...(sospechosa && { reportes: { create: { riesgo, motivo } } }),
            anclaje: {
              create: {
                huella: huellaResena({
                  id,
                  destinoId: destino.id,
                  calificacion,
                  comentario,
                }),
              },
            },
            ...analizarSentimiento(comentario),
          },
          select: { id: true },
        });
        await actualizarPromedioResenas(transaccion, destino.id);
        return resena;
      },
    );
    this.cacheSentimiento.delete(slug);
    this.destinos.limpiarCache();
    await this.puntos.acreditar(resenaPublicada.id).catch(() => undefined);
    return resenaPublicada;
  }

  async votar(resenaId: string, usuarioId: string, util: boolean) {
    const cliente = this.prisma.cliente;
    if (
      !(await cliente.resena.findFirst({
        where: {
          id: resenaId,
          retiradaEn: null,
          destino: { estadoEditorial: 'publicada' },
        },
        select: { id: true },
      }))
    ) {
      throw new NotFoundException('La reseña ya no está disponible.');
    }
    if (util)
      await cliente.votoResena.createMany({
        data: { resenaId, usuarioId },
        skipDuplicates: true,
      });
    else
      await cliente.votoResena.deleteMany({ where: { resenaId, usuarioId } });
  }
}
