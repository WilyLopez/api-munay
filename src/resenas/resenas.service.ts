import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, RolUsuario } from '../generated/prisma/client.js';
import { ServicioPrisma } from '../prisma/prisma.service.js';

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
    _count: { select: { votos: true } },
    votos: usuarioId
      ? { where: { usuarioId }, select: { usuarioId: true } }
      : false,
  } satisfies Prisma.ResenaSelect;
}

@Injectable()
export class ResenasService {
  constructor(private readonly prisma: ServicioPrisma) {}

  async listar(
    slug: string | undefined,
    orden: string | undefined,
    pagina: number,
    perfil?: PerfilResenas,
  ) {
    const cliente = this.prisma.cliente;
    const destino = slug
      ? await cliente.destino.findUnique({
          where: { slug },
          select: { id: true },
        })
      : null;
    if (slug && !destino)
      throw new NotFoundException('El destino no está disponible.');
    const where = destino ? { destinoId: destino.id } : {};
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
            select: { resena: { select: { id: true } } },
          })
        : null,
      cliente.destino.findMany({
        select: { nombre: true, slug: true },
        orderBy: { nombre: 'asc' },
      }),
    ]);
    const total = grupos.reduce((suma, grupo) => suma + grupo._count._all, 0);
    return {
      destinos,
      resenas: filas
        .slice(0, TAMANO_PAGINA)
        .map(({ visitaId, _count, votos, ...fila }) => ({
          ...fila,
          verificada: Boolean(visitaId),
          utiles: _count.votos,
          votoPropio: Boolean(votos?.length),
        })),
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
      estado: !perfil
        ? 'visitante'
        : visita?.resena
          ? 'publicada'
          : visita
            ? 'habilitada'
            : 'bloqueada',
    };
  }

  async publicar(
    slug: string,
    perfil: PerfilResenas,
    calificacion: unknown,
    texto: unknown,
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
    if (!comentario || Array.from(comentario).length > 2000)
      throw new BadRequestException(
        'Escribe un comentario de 1 a 2000 caracteres.',
      );
    return this.prisma.cliente.$transaction(async (transaccion) => {
      const destino = await transaccion.destino.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (!destino)
        throw new NotFoundException('El destino no está disponible.');
      await transaccion.$queryRaw`SELECT id FROM munay.destinos WHERE id = ${destino.id}::uuid FOR NO KEY UPDATE`;
      const visita = await transaccion.visitaVerificada.findUnique({
        where: {
          usuarioId_destinoId: { usuarioId: perfil.id, destinoId: destino.id },
        },
        select: { id: true, resena: { select: { id: true } } },
      });
      if (!visita)
        throw new ForbiddenException(
          'Verifica tu visita mediante el QR del destino.',
        );
      if (visita.resena)
        throw new ConflictException(
          'Ya publicaste una reseña para esta visita.',
        );
      const resena = await transaccion.resena.create({
        data: {
          usuarioId: perfil.id,
          destinoId: destino.id,
          visitaId: visita.id,
          calificacion,
          comentario,
        },
        select: { id: true },
      });
      const resumen = await transaccion.resena.aggregate({
        where: { destinoId: destino.id },
        _avg: { calificacion: true },
      });
      await transaccion.destino.update({
        where: { id: destino.id },
        data: { calificacionPromedio: resumen._avg.calificacion?.toFixed(2) },
      });
      return resena;
    });
  }

  async votar(resenaId: string, usuarioId: string, util: boolean) {
    const cliente = this.prisma.cliente;
    if (
      !(await cliente.resena.findUnique({
        where: { id: resenaId },
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
