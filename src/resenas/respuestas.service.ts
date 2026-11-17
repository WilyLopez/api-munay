import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ServicioPrisma } from '../prisma/prisma.service.js';
import type { PerfilResenas } from './resenas.service.js';

const campos = {
  id: true,
  usuarioId: true,
  comentario: true,
  creadaEn: true,
  usuario: { select: { nombreCompleto: true } },
} as const;

@Injectable()
export class RespuestasService {
  constructor(private readonly prisma: ServicioPrisma) {}

  async listar(resenaId: string, pagina: number, perfil?: PerfilResenas) {
    const resena = await this.prisma.cliente.resena.findFirst({
      where: {
        id: resenaId,
        retiradaEn: null,
        destino: { estadoEditorial: 'publicada' },
      },
      select: { id: true },
    });
    if (!resena)
      throw new NotFoundException('Esta reseña ya no está disponible.');
    const respuestas = await this.prisma.cliente.respuestaResena.findMany({
      where: {
        resenaId,
        retiradaEn: null,
        resena: { retiradaEn: null, destino: { estadoEditorial: 'publicada' } },
      },
      orderBy: [{ creadaEn: 'desc' }, { id: 'desc' }],
      skip: (pagina - 1) * 10,
      take: 11,
      select: campos,
    });
    return {
      respuestas: respuestas
        .slice(0, 10)
        .map(({ usuarioId, ...respuesta }) => ({
          ...respuesta,
          propia: perfil?.id === usuarioId,
        })),
      hayMas: respuestas.length > 10,
      puedeResponder: perfil?.rol === 'TURISTA',
    };
  }

  async publicar(
    resenaId: string,
    perfil: PerfilResenas,
    comentario: unknown,
    solicitudId: unknown,
  ) {
    if (perfil.rol !== 'TURISTA')
      throw new ForbiddenException('Responde con una cuenta de visitante.');
    const texto = typeof comentario === 'string' ? comentario.trim() : '';
    if (!texto || Array.from(texto).length > 1000)
      throw new BadRequestException(
        'Escribe una respuesta de 1 a 1000 caracteres.',
      );
    if (
      typeof solicitudId !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        solicitudId,
      )
    )
      throw new BadRequestException('La solicitud no es válida.');
    return this.prisma.cliente.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM munay.resenas WHERE id = ${resenaId}::uuid FOR NO KEY UPDATE`;
      const resena = await tx.resena.findFirst({
        where: {
          id: resenaId,
          retiradaEn: null,
          destino: { estadoEditorial: 'publicada' },
        },
        select: { id: true },
      });
      if (!resena)
        throw new NotFoundException('Esta reseña ya no está disponible.');
      await tx.$queryRaw`SELECT id FROM munay.usuarios WHERE id = ${perfil.id}::uuid FOR NO KEY UPDATE`;
      const anterior = await tx.respuestaResena.findUnique({
        where: { id: solicitudId },
      });
      if (anterior) {
        if (
          anterior.usuarioId === perfil.id &&
          anterior.resenaId === resenaId &&
          anterior.comentario === texto &&
          !anterior.retiradaEn
        )
          return { id: anterior.id };
        throw new ConflictException('Esta solicitud ya fue utilizada.');
      }
      const recientes = await tx.respuestaResena.count({
        where: {
          usuarioId: perfil.id,
          creadaEn: { gte: new Date(Date.now() - 60000) },
        },
      });
      if (recientes >= 5)
        throw new BadRequestException(
          'Has enviado varias respuestas. Espera un minuto antes de continuar.',
        );
      return tx.respuestaResena.create({
        data: {
          id: solicitudId,
          usuarioId: perfil.id,
          resenaId,
          comentario: texto,
        },
        select: { id: true },
      });
    });
  }

  async retirar(id: string, perfil: PerfilResenas) {
    const respuesta = await this.prisma.cliente.respuestaResena.updateMany({
      where: {
        id,
        ...(perfil.rol === 'SUPER_ADMIN' ? {} : { usuarioId: perfil.id }),
        retiradaEn: null,
      },
      data: { retiradaEn: new Date() },
    });
    if (!respuesta.count)
      throw new NotFoundException(
        'La respuesta ya no está disponible para tu cuenta.',
      );
  }
}
