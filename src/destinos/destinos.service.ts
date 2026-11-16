import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  alcanceAdministrador,
  type PerfilConRol,
} from '../autenticacion/alcance-administrador.js';
import { Prisma } from '../generated/prisma/client.js';
import { ServicioPrisma } from '../prisma/prisma.service.js';
import {
  validarDatosDestino,
  validarInformacion,
} from './informacion-destino.js';

const camposFicha = {
  fotosAdicionales: true,
  diasAtencion: true,
  rutaDesdeChiclayo: true,
  distanciaKm: true,
  duracionMinutos: true,
  recomendacion: true,
  fuenteRutaUrl: true,
  informacion: true,
  revisadoEn: true,
} satisfies Prisma.DestinoSelect;

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

type DestinoPublico = ReturnType<
  typeof serializarDestino<
    Prisma.DestinoGetPayload<{ select: ReturnType<typeof seleccionarDestino> }>
  >
>;

@Injectable()
export class DestinosService {
  private cachePublico?: {
    destinos: DestinoPublico[];
    expiraEn: number;
  };
  private cacheDetalles = new Map<
    string,
    {
      destino: DestinoPublico & { totalResenas: number };
      expiraEn: number;
    }
  >();

  constructor(private readonly prisma: ServicioPrisma) {}

  limpiarCache() {
    this.cachePublico = undefined;
    this.cacheDetalles.clear();
  }

  resumenAdministrado(perfil: PerfilConRol) {
    return this.prisma.cliente.destino.findMany({
      where: alcanceAdministrador(perfil),
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        slug: true,
        nombre: true,
        ubicacion: true,
        provincia: true,
        categoria: true,
        estadoEditorial: true,
        _count: {
          select: { visitas: true, resenas: { where: { retiradaEn: null } } },
        },
      },
    });
  }

  async obtenerFichaOperativa(slug: string, perfil: PerfilConRol) {
    const ficha = await this.prisma.cliente.destino.findFirst({
      where: { slug, ...alcanceAdministrador(perfil) },
      select: {
        ...seleccionarDestino(),
        ...camposFicha,
        estadoEditorial: true,
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
    const permitidos = [
      'horario',
      'tarifaGeneral',
      'tarifaEstudiantes',
      'diasAtencion',
      'datos',
      'informacion',
      'enviarRevision',
    ];
    if (Object.keys(entrada).some((campo) => !permitidos.includes(campo))) {
      throw new BadRequestException(
        'La ficha incluye campos que no se pueden editar aquí.',
      );
    }
    const {
      horario,
      tarifaGeneral,
      tarifaEstudiantes,
      diasAtencion,
      datos,
      informacion,
      enviarRevision,
    } = entrada as Record<string, unknown>;
    const datosValidados =
      datos === undefined
        ? undefined
        : validarDatosDestino(
            datos && typeof datos === 'object' && !Array.isArray(datos)
              ? (datos as Record<string, unknown>)
              : {},
          );
    const informacionValidada =
      informacion === undefined ? undefined : validarInformacion(informacion);
    const galeria = informacionValidada
      ? (informacionValidada.galeria as { url: string }[]).map(({ url }) => url)
      : undefined;
    if (datosValidados || galeria) {
      const actual = await this.prisma.cliente.destino.findFirst({
        where,
        select: { id: true, imagenUrl: true, fotosAdicionales: true },
      });
      if (!actual)
        throw new NotFoundException(
          'El atractivo no está disponible para tu cuenta.',
        );
      const base = process.env.SUPABASE_URL?.replace(/\/+$/, '');
      const prefijo =
        base && `${base}/storage/v1/object/public/destinos/${actual.id}/`;
      const existentes = new Set([
        actual.imagenUrl,
        ...actual.fotosAdicionales,
      ]);
      const archivos = [datosValidados?.imagenUrl, ...(galeria ?? [])];
      if (
        archivos.some(
          (archivo) =>
            archivo &&
            !existentes.has(archivo) &&
            !(
              prefijo &&
              archivo.startsWith(prefijo) &&
              /^[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(
                archivo.slice(prefijo.length),
              )
            ),
        )
      ) {
        throw new BadRequestException(
          'Sube las nuevas fotos desde el editor del destino.',
        );
      }
    }
    if (enviarRevision !== undefined && typeof enviarRevision !== 'boolean')
      throw new BadRequestException('Revisa la acción de la ficha.');
    if (
      enviarRevision &&
      (!datosValidados?.imagenUrl ||
        !informacionValidada?.distrito ||
        !informacionValidada.condicion ||
        !informacionValidada.modalidadIngreso)
    )
      throw new BadRequestException(
        'Completa el distrito, la portada, la condición y la modalidad de ingreso.',
      );
    if (
      horario !== null &&
      (typeof horario !== 'string' || horario.trim().length > 240)
    ) {
      throw new BadRequestException(
        'El horario debe tener hasta 240 caracteres.',
      );
    }
    if (
      diasAtencion !== undefined &&
      (!Array.isArray(diasAtencion) ||
        diasAtencion.length > 7 ||
        diasAtencion.some(
          (dia) => !Number.isInteger(dia) || dia < 0 || dia > 6,
        ) ||
        new Set(diasAtencion).size !== diasAtencion.length)
    )
      throw new BadRequestException(
        'Selecciona días de atención válidos y sin duplicados.',
      );
    const { count } = await this.prisma.cliente.destino.updateMany({
      where: {
        ...where,
        ...(enviarRevision
          ? { estadoEditorial: 'borrador' }
          : perfil.rol === 'ADMIN_DESTINO'
            ? { estadoEditorial: { in: ['borrador', 'publicada'] } }
            : {}),
      },
      data: {
        ...datosValidados,
        ...(informacionValidada && {
          informacion: informacionValidada,
          fotosAdicionales: galeria,
        }),
        ...(enviarRevision && { estadoEditorial: 'en_revision' }),
        horario: typeof horario === 'string' ? horario.trim() || null : null,
        tarifaGeneral: validarTarifa(tarifaGeneral),
        tarifaEstudiantes: validarTarifa(tarifaEstudiantes),
        ...(Array.isArray(diasAtencion) && {
          diasAtencion: diasAtencion.toSorted((a, b) => a - b),
        }),
      },
    });
    if (!count) {
      if (await this.prisma.cliente.destino.count({ where }))
        throw new ConflictException(
          'La ficha no está disponible para esta edición.',
        );
      throw new NotFoundException(
        'El atractivo no está disponible para tu cuenta.',
      );
    }
    this.limpiarCache();
  }

  async revisarFicha(slug: string, perfil: PerfilConRol, estado: unknown) {
    if (perfil.rol !== 'SUPER_ADMIN') throw new ForbiddenException();
    if (estado === 'verificar' || estado === 'quitar_verificacion') {
      const { count } = await this.prisma.cliente.destino.updateMany({
        where: { slug, estadoEditorial: 'publicada' },
        data: { verificado: estado === 'verificar', revisadoEn: new Date() },
      });
      if (!count) throw new ConflictException('El destino debe estar publicado.');
      this.limpiarCache();
      return;
    }
    switch (estado) {
      case 'publicada':
      case 'borrador':
      case 'archivada':
        break;
      default:
        throw new BadRequestException('Selecciona un estado válido.');
    }
    const origen =
      estado === 'publicada'
        ? ['en_revision']
        : estado === 'borrador'
          ? ['en_revision', 'archivada']
          : ['publicada'];
    const { count } = await this.prisma.cliente.destino.updateMany({
      where: { slug, estadoEditorial: { in: origen } },
      data: { estadoEditorial: estado, revisadoEn: new Date() },
    });
    if (!count)
      throw new ConflictException(
        'Esta ficha cambió de estado. Actualiza la página.',
      );
    this.limpiarCache();
  }

  async listar(usuarioId?: string) {
    if (!usuarioId) {
      const ahora = Date.now();
      if (this.cachePublico && this.cachePublico.expiraEn > ahora) {
        return this.cachePublico.destinos;
      }
    }

    const destinos = await this.prisma.cliente.destino.findMany({
      where: { estadoEditorial: 'publicada' },
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      select: {
        ...seleccionarDestino(usuarioId),
        _count: { select: { resenas: { where: { retiradaEn: null } } } },
      },
    });

    const resultado = destinos.map(({ _count, ...destino }) => ({
      ...serializarDestino(destino),
      totalResenas: _count.resenas,
    }));
    if (!usuarioId) {
      this.cachePublico = {
        destinos: resultado,
        expiraEn: Date.now() + 60_000,
      };
    }
    return resultado;
  }

  async obtener(slug: string, usuarioId?: string) {
    if (!usuarioId) {
      const ahora = Date.now();
      const cacheado = this.cacheDetalles.get(slug);
      if (cacheado && cacheado.expiraEn > ahora) {
        return cacheado.destino;
      }
    }

    const destino = await this.prisma.cliente.destino.findUnique({
      where: { slug, estadoEditorial: 'publicada' },
      select: {
        ...seleccionarDestino(usuarioId),
        _count: { select: { resenas: { where: { retiradaEn: null } } } },
        ...camposFicha,
      },
    });

    if (!destino) {
      throw new NotFoundException('El destino no está disponible.');
    }

    const { _count, ...detalle } = destino;
    const resultado = {
      ...serializarDestino(detalle),
      totalResenas: _count.resenas,
    };
    if (!usuarioId) {
      if (this.cacheDetalles.size > 100) this.cacheDetalles.clear();
      this.cacheDetalles.set(slug, {
        destino: resultado,
        expiraEn: Date.now() + 60_000,
      });
    }
    return resultado;
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
    this.limpiarCache();
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
