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
import { alcanceAdministrador } from '../autenticacion/alcance-administrador.js';

export type PerfilResenas = { id: string; rol: RolUsuario };
const TAMANO_PAGINA = 20;

function seleccionarResena(usuarioId?: string) {
  return {
    id: true,
    comentario: true,
    calificacion: true,
    creadaEn: true,
    visitaId: true,
    visita: { select: { verificadaEn: true } },
    fotoUrl: true,
    respuestas: {
      where: { retiradaEn: null, oficial: true },
      take: 1,
      select: { id: true },
    },
    usuario: { select: { nombreCompleto: true } },
    destino: { select: { nombre: true, slug: true, imagenUrl: true } },
    anclaje: { select: { huella: true, estado: true, transaccion: true } },
    _count: {
      select: { votos: true, respuestas: { where: { retiradaEn: null } } },
    },
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
  visita,
  respuestas,
  ...fila
}: Prisma.ResenaGetPayload<{ select: ReturnType<typeof seleccionarResena> }>) {
  return {
    ...fila,
    verificada: Boolean(visitaId),
    fechaVisita: visita?.verificadaEn ?? null,
    totalRespuestas: _count.respuestas,
    respuestaOficial: Boolean(respuestas?.length),
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
    filtros: {
      estrellas?: string;
      desde?: string;
      hasta?: string;
      foto?: string;
      respuesta?: string;
      administracion?: string;
    } = {},
  ) {
    const cliente = this.prisma.cliente;
    const administrativo = filtros.administracion === '1';
    if (
      administrativo &&
      (!perfil ||
        !slug ||
        !['ADMIN_DESTINO', 'SUPER_ADMIN'].includes(perfil.rol))
    )
      throw new ForbiddenException(
        'Selecciona un atractivo autorizado para consultar sus reseñas.',
      );
    const alcance = administrativo
      ? alcanceAdministrador(perfil!)
      : { estadoEditorial: 'publicada' };
    if (filtros.estrellas && !/^[1-5]$/.test(filtros.estrellas))
      throw new BadRequestException('Selecciona una calificación entre 1 y 5.');
    const fechaFiltro = (valor: string | undefined, fin: boolean) => {
      if (!valor) return undefined;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(valor))
        throw new BadRequestException('La fecha no es válida.');
      const fecha = new Date(
        `${valor}T${fin ? '23:59:59.999' : '00:00:00.000'}-05:00`,
      );
      if (
        !Number.isFinite(fecha.getTime()) ||
        new Date(`${valor}T00:00:00Z`).toISOString().slice(0, 10) !== valor
      )
        throw new BadRequestException('La fecha no es válida.');
      return fecha;
    };
    const desde = fechaFiltro(filtros.desde, false);
    const hasta = fechaFiltro(filtros.hasta, true);
    if (desde && hasta && desde > hasta)
      throw new BadRequestException(
        'La fecha inicial debe ser anterior a la final.',
      );
    const destino = slug
      ? await cliente.destino.findUnique({
          where: { slug, AND: alcance },
          select: { id: true, nombre: true },
        })
      : null;
    if (slug && !destino)
      throw new NotFoundException('El destino no está disponible.');
    const where: Prisma.ResenaWhereInput = {
      retiradaEn: null,
      destino: alcance,
      ...(destino && { destinoId: destino.id }),
      ...(filtros.estrellas && { calificacion: Number(filtros.estrellas) }),
      ...((desde || hasta) && {
        creadaEn: {
          ...(desde && { gte: desde }),
          ...(hasta && { lte: hasta }),
        },
      }),
      ...(filtros.foto === '1' && { fotoUrl: { not: null } }),
      ...(filtros.respuesta === 'pendiente' && {
        respuestas: { none: { retiradaEn: null, oficial: true } },
      }),
      ...(filtros.respuesta === 'respondida' && {
        respuestas: { some: { retiradaEn: null, oficial: true } },
      }),
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
            : orden === 'menor'
              ? [{ calificacion: 'asc' }, ...ordenFecha]
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
              verificadaEn: true,
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
      fechaVisita: visita?.verificadaEn ?? null,
      puntosResena: 10,
      puntosSelfie: 5,
      puedeResponder: perfil?.rol === 'TURISTA',
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

  async prepararPublicacion(slug: string, perfil: PerfilResenas) {
    if (perfil.rol !== 'TURISTA')
      throw new ForbiddenException(
        'Escribe tu reseña con una cuenta de visitante.',
      );
    const destino = await this.prisma.cliente.destino.findUnique({
      where: { slug, estadoEditorial: 'publicada' },
      select: { id: true, slug: true, nombre: true, imagenUrl: true },
    });
    if (!destino)
      throw new NotFoundException('El atractivo ya no está disponible.');
    const visita = await this.prisma.cliente.visitaVerificada.findUnique({
      where: {
        usuarioId_destinoId: { usuarioId: perfil.id, destinoId: destino.id },
      },
      select: {
        verificadaEn: true,
        resena: { select: { id: true, retiradaEn: true } },
      },
    });
    return {
      destino,
      fechaVisita: visita?.verificadaEn ?? null,
      estado: !visita
        ? 'bloqueada'
        : !visita.resena
          ? 'habilitada'
          : visita.resena.retiradaEn
            ? 'retirada'
            : 'publicada',
      resenaId: visita?.resena?.id ?? null,
      puntosResena: 10,
      puntosSelfie: 5,
    };
  }

  async publicar(
    slug: string,
    perfil: PerfilResenas,
    calificacion: unknown,
    texto: unknown,
    solicitudId?: unknown,
    foto?: unknown,
    selfie?: unknown,
    consentimientoFoto?: unknown,
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
    if (selfie !== undefined && typeof selfie !== 'boolean')
      throw new BadRequestException('Revisa la declaración de la selfie.');
    if (selfie === true && !foto)
      throw new BadRequestException(
        'Adjunta tu selfie para recibir los puntos adicionales.',
      );
    let fotoUrl: string | null = null;
    if (foto !== undefined && foto !== null && foto !== '') {
      if (consentimientoFoto !== true)
        throw new BadRequestException(
          'Autoriza la publicación de tu foto para continuar.',
        );
      if (
        typeof foto !== 'string' ||
        !new RegExp(
          '^' + perfil.id + '/[a-f0-9-]{36}/[a-f0-9-]{36}\\.(jpg|png|webp)$',
        ).test(foto)
      ) {
        throw new BadRequestException('La foto no pertenece a esta cuenta.');
      }
      const [objeto] = await this.prisma.cliente.$queryRaw<
        { destinoId: string }[]
      >`
        SELECT (string_to_array(o.name, '/'))[2] AS "destinoId"
        FROM storage.objects o
        WHERE o.bucket_id = 'resenas' AND o.name = ${foto}
          AND o.owner_id = ${perfil.id}
          AND o.metadata->>'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')
          AND (o.metadata->>'size')::bigint BETWEEN 1 AND 5242880
        LIMIT 1
      `;
      if (!objeto)
        throw new BadRequestException(
          'Sube una foto JPG, PNG o WebP de hasta 5 MB.',
        );
      const destinoFoto = await this.prisma.cliente.destino.findUnique({
        where: { slug, estadoEditorial: 'publicada' },
        select: { id: true },
      });
      if (!destinoFoto || objeto.destinoId !== destinoFoto.id)
        throw new BadRequestException('La foto no corresponde a este destino.');
      const base = process.env.SUPABASE_URL;
      if (!base)
        throw new BadRequestException(
          'Las fotos no están disponibles en este momento.',
        );
      fotoUrl = new URL('/storage/v1/object/public/resenas/' + foto, base).href;
    }
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
                fotoUrl: true,
                selfieDeclarada: true,
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
            visita.resena.comentario === comentario &&
            (visita.resena.fotoUrl ?? null) === fotoUrl &&
            Boolean(visita.resena.selfieDeclarada) === (selfie === true)
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
            fotoUrl,
            selfieDeclarada: selfie === true,
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
