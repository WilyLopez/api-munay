import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  alcanceAdministrador,
  type PerfilConRol,
} from '../autenticacion/alcance-administrador.js';
import { Prisma } from '../generated/prisma/client.js';
import { ServicioPrisma } from '../prisma/prisma.service.js';

function seleccionarDestino(usuarioId?: string) {
  return {
    id: true,
    slug: true,
    ordenPortada: true,
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

  async obtenerFichaOperativa(slug: string, perfil: PerfilConRol) {
    const ficha = await this.prisma.cliente.destino.findFirst({
      where: { slug, ...alcanceAdministrador(perfil) },
      select: {
        nombre: true,
        horario: true,
        tarifaGeneral: true,
        tarifaEstudiantes: true,
      },
    });
    if (!ficha)
      throw new NotFoundException(
        'El atractivo no está disponible para tu cuenta.',
      );
    return {
      ...ficha,
      tarifaGeneral: ficha.tarifaGeneral?.toFixed(2) ?? null,
      tarifaEstudiantes: ficha.tarifaEstudiantes?.toFixed(2) ?? null,
    };
  }

  async actualizarFichaOperativa(
    slug: string,
    perfil: PerfilConRol,
    entrada: unknown,
  ) {
    const where = { slug, ...alcanceAdministrador(perfil) };
    if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
      throw new BadRequestException('Revisa los datos de la ficha.');
    }
    const permitidos = ['horario', 'tarifaGeneral', 'tarifaEstudiantes'];
    if (Object.keys(entrada).some((campo) => !permitidos.includes(campo))) {
      throw new BadRequestException(
        'La ficha incluye campos que no se pueden editar aquí.',
      );
    }
    const { horario, tarifaGeneral, tarifaEstudiantes } = entrada as Record<
      string,
      unknown
    >;
    if (
      horario !== null &&
      (typeof horario !== 'string' || horario.trim().length > 240)
    ) {
      throw new BadRequestException(
        'El horario debe tener hasta 240 caracteres.',
      );
    }
    const { count } = await this.prisma.cliente.destino.updateMany({
      where,
      data: {
        horario: typeof horario === 'string' ? horario.trim() || null : null,
        tarifaGeneral: validarTarifa(tarifaGeneral),
        tarifaEstudiantes: validarTarifa(tarifaEstudiantes),
      },
    });
    if (!count)
      throw new NotFoundException(
        'El atractivo no está disponible para tu cuenta.',
      );
  }

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
        _count: { select: { resenas: { where: { retiradaEn: null } } } },
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

    const { _count, ...detalle } = destino;
    return { ...serializarDestino(detalle), totalResenas: _count.resenas };
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

  async actualizarOrdenPortada(id: string, ordenPortada: number | null) {
    const { count } = await this.prisma.cliente.destino.updateMany({
      where: { id },
      data: { ordenPortada },
    });
    if (!count) throw new NotFoundException('El destino no está disponible.');
  }

  async quitarFavorito(usuarioId: string, destinoId: string) {
    await this.prisma.cliente.favorito.deleteMany({
      where: { usuarioId, destinoId },
    });
  }
}

function validarTarifa(valor: unknown) {
  if (valor === null) return null;
  if (typeof valor !== 'string' || !/^\d{1,8}(?:\.\d{1,2})?$/.test(valor)) {
    throw new BadRequestException(
      'Ingresa una tarifa válida en soles, con hasta dos decimales.',
    );
  }
  return new Prisma.Decimal(valor);
}
