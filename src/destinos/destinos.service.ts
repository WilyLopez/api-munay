import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { ServicioPrisma } from '../prisma/prisma.service.js';

function seleccionarDestino(usuarioId?: string) {
  return {
    id: true,
    slug: true,
    nombre: true,
    descripcion: true,
    ubicacion: true,
    categoria: true,
    provincia: true,
    latitud: true,
    longitud: true,
    imagenUrl: true,
    horario: true,
    tarifaGeneral: true,
    tarifaEstudiantes: true,
    calificacionPromedio: true,
    verificado: true,
    favoritos: usuarioId
      ? { where: { usuarioId }, select: { usuarioId: true } }
      : false,
  } satisfies Prisma.DestinoSelect;
}

function serializarDestino<
  T extends Prisma.DestinoGetPayload<{
    select: ReturnType<typeof seleccionarDestino>;
  }>,
>({
  favoritos,
  calificacionPromedio,
  tarifaGeneral,
  tarifaEstudiantes,
  ...destino
}: T) {
  return {
    ...destino,
    calificacionPromedio: calificacionPromedio?.toNumber() ?? null,
    tarifaGeneral: tarifaGeneral?.toNumber() ?? null,
    tarifaEstudiantes: tarifaEstudiantes?.toNumber() ?? null,
    favorito: Boolean(favoritos?.length),
  };
}

@Injectable()
export class DestinosService {
  constructor(private readonly prisma: ServicioPrisma) {}

  async listar(usuarioId?: string) {
    const destinos = await this.prisma.cliente.destino.findMany({
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      select: seleccionarDestino(usuarioId),
    });

    return destinos.map(serializarDestino);
  }

  async obtener(slug: string, usuarioId?: string) {
    const destino = await this.prisma.cliente.destino.findUnique({
      where: { slug },
      select: {
        ...seleccionarDestino(usuarioId),
        fotosAdicionales: true,
        diasAtencion: true,
        rutaDesdeChiclayo: true,
        distanciaKm: true,
        duracionMinutos: true,
        recomendacion: true,
        fuenteRutaUrl: true,
      },
    });

    if (!destino) {
      throw new NotFoundException('El destino no está disponible.');
    }

    return serializarDestino(destino);
  }

  async guardarFavorito(usuarioId: string, destinoId: string) {
    try {
      await this.prisma.cliente.favorito.createMany({
        data: { usuarioId, destinoId },
        skipDuplicates: true,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new NotFoundException('El destino ya no está disponible.');
      }

      throw error;
    }
  }

  async quitarFavorito(usuarioId: string, destinoId: string) {
    await this.prisma.cliente.favorito.deleteMany({
      where: { usuarioId, destinoId },
    });
  }
}
