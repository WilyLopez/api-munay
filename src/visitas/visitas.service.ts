import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  alcanceAdministrador,
  type PerfilConRol as Perfil,
} from '../autenticacion/alcance-administrador.js';
import type { Prisma } from '../generated/prisma/client.js';
import { ServicioPrisma } from '../prisma/prisma.service.js';
import { RADIO_VISITA_METROS, validarGeocerca } from './geocerca.js';

const VIGENCIA_MS = 60_000;
const VIGENCIA_PERMISO_MS = 5 * 60_000;
const PREFIJO = 'munay:visita:';
const FORMATO_CODIGO =
  /^munay:visita:([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
const TAMANO_PAGINA = 25;
const camposDestino = { id: true, nombre: true, slug: true } as const;
const camposVisita = { id: true, verificadaEn: true } as const;

function comprobarVigencia(
  codigo: { usadoEn: Date | null; venceEn: Date; anuladoEn: Date | null },
  ahora: Date,
) {
  if (codigo.usadoEn)
    throw new ConflictException(
      'Este QR ya fue usado. Escanea el código nuevo.',
    );
  if (codigo.anuladoEn)
    throw new GoneException(
      'El QR fue reemplazado. Escanea el código vigente.',
    );
  if (codigo.venceEn <= ahora)
    throw new GoneException('El QR expiró. Escanea el código vigente.');
}

function bloquearDestino(
  transaccion: Prisma.TransactionClient,
  destinoId: string,
) {
  return transaccion.$queryRaw`
    SELECT id FROM munay.destinos WHERE id = ${destinoId}::uuid FOR NO KEY UPDATE
  `;
}

@Injectable()
export class VisitasService {
  constructor(private readonly prisma: ServicioPrisma) {}

  listarDestinos(perfil: Perfil) {
    return this.prisma.cliente.destino.findMany({
      where: alcanceAdministrador(perfil),
      select: camposDestino,
      orderBy: { nombre: 'asc' },
    });
  }

  private async obtenerDestinoAdministrado(perfil: Perfil, slug: string) {
    const destino = await this.prisma.cliente.destino.findFirst({
      where: { slug, ...alcanceAdministrador(perfil) },
      select: camposDestino,
    });
    if (!destino)
      throw new NotFoundException(
        'El destino no está disponible para esta cuenta.',
      );
    return destino;
  }

  async sincronizar(
    perfil: Perfil,
    slug: string,
    renovar: boolean,
    codigoId?: string,
  ) {
    const destino = await this.obtenerDestinoAdministrado(perfil, slug);
    if (
      !(await this.prisma.cliente.destino.count({
        where: { id: destino.id, estadoEditorial: 'publicada' },
      }))
    )
      throw new BadRequestException(
        'Publica el destino antes de generar el QR de visitas.',
      );
    const codigo = await this.obtenerCodigoPantalla(destino.id, renovar, codigoId);

    const fechaLima = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Lima',
    }).format(new Date());
    const [recientes, totalHoy] = await Promise.all([
      this.prisma.cliente.visitaVerificada.findMany({
        where: { destinoId: destino.id },
        select: camposVisita,
        orderBy: [{ verificadaEn: 'desc' }, { id: 'desc' }],
        take: 8,
      }),
      this.prisma.cliente.visitaVerificada.count({
        where: {
          destinoId: destino.id,
          verificadaEn: { gte: new Date(`${fechaLima}T00:00:00-05:00`) },
        },
      }),
    ]);

    return {
      destino,
      codigo: {
        id: codigo.id,
        valor: PREFIJO + codigo.id,
        creadoEn: codigo.creadoEn,
        venceEn: codigo.venceEn,
      },
      horaServidor: new Date(),
      recientes,
      totalHoy,
    };
  }

  private obtenerCodigoPantalla(destinoId: string, renovar: boolean, codigoId?: string) {
    return this.prisma.cliente.$transaction(
      async (transaccion) => {
        await bloquearDestino(transaccion, destinoId);
        const ahora = new Date();
        const actual = await transaccion.codigoVisita.findFirst({
          where: {
            destinoId: destinoId,
            usadoEn: null,
            anuladoEn: null,
            venceEn: { gt: ahora },
          },
          orderBy: { creadoEn: 'desc' },
        });

        if (
          actual &&
          (!renovar || (codigoId !== undefined && actual.id !== codigoId))
        )
          return actual;
        if (actual) {
          await transaccion.codigoVisita.update({
            where: { id: actual.id },
            data: { anuladoEn: ahora },
          });
        }
        return transaccion.codigoVisita.create({
          data: {
            destinoId: destinoId,
            creadoEn: ahora,
            venceEn: new Date(ahora.getTime() + VIGENCIA_MS),
          },
        });
      },
    );

  }

  async consultarPantallaPublica(slug: string) {
    const destino = await this.prisma.cliente.destino.findFirst({
      where: { slug, estadoEditorial: 'publicada' },
      select: camposDestino,
    });
    if (!destino) throw new NotFoundException('El atractivo no está disponible.');
    const codigo = await this.obtenerCodigoPantalla(destino.id, false);
    return {
      destino,
      codigo: {
        id: codigo.id,
        valor: PREFIJO + codigo.id,
        creadoEn: codigo.creadoEn,
        venceEn: codigo.venceEn,
      },
      horaServidor: new Date(),
    };
  }

  async historial(perfil: Perfil, slug: string, pagina: number) {
    const destino = await this.obtenerDestinoAdministrado(perfil, slug);
    const registros = await this.prisma.cliente.visitaVerificada.findMany({
      where: { destinoId: destino.id },
      select: camposVisita,
      orderBy: [{ verificadaEn: 'desc' }, { id: 'desc' }],
      skip: (pagina - 1) * TAMANO_PAGINA,
      take: TAMANO_PAGINA + 1,
    });
    return {
      registros: registros.slice(0, TAMANO_PAGINA),
      hayMas: registros.length > TAMANO_PAGINA,
    };
  }

  async estadisticas(perfil: Perfil, slug: string, meses: number) {
    const destino = await this.obtenerDestinoAdministrado(perfil, slug);
    const ahora = new Date();
    const [anio, mes] = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Lima',
    })
      .format(ahora)
      .split('-')
      .map(Number);
    const periodos = Array.from(
      { length: meses },
      (_, indice) => new Date(Date.UTC(anio, mes - meses + indice, 1, 5)),
    );
    const desde = periodos[0];
    const filtroResenas = {
      destinoId: destino.id,
      retiradaEn: null,
      creadaEn: { gte: desde, lte: ahora },
    };
    const cliente = this.prisma.cliente;
    const [visitas, resumen, recientes] = await Promise.all([
      cliente.$queryRaw<{ mes: string; total: number }[]>`
        SELECT to_char("verificada_en" AT TIME ZONE 'America/Lima', 'YYYY-MM') AS mes,
               count(*)::int AS total
        FROM "munay"."visitas_verificadas"
        WHERE "destino_id" = ${destino.id}::uuid AND "verificada_en" BETWEEN ${desde} AND ${ahora}
        GROUP BY 1
      `,
      cliente.resena.aggregate({
        where: filtroResenas,
        _avg: { calificacion: true },
        _count: { _all: true },
      }),
      cliente.resena.findMany({
        where: filtroResenas,
        select: {
          id: true,
          usuario: { select: { nombreCompleto: true } },
          calificacion: true,
          comentario: true,
          creadaEn: true,
          visitaId: true,
        },
        orderBy: [{ creadaEn: 'desc' }, { id: 'desc' }],
        take: 5,
      }),
    ]);
    const tendencia = periodos.map((fecha) => {
      const mes = fecha.toISOString().slice(0, 7);
      return {
        mes,
        total: visitas.find((visita) => visita.mes === mes)?.total ?? 0,
      };
    });
    return {
      tendencia,
      totalVisitas: tendencia.reduce(
        (total, periodo) => total + periodo.total,
        0,
      ),
      totalResenas: resumen._count._all,
      promedio: resumen._avg.calificacion,
      recientes: recientes.map(({ visitaId, ...resena }) => ({
        ...resena,
        verificada: Boolean(visitaId),
      })),
      actualizadoEn: ahora,
    };
  }

  private async obtenerCodigo(perfil: Perfil, texto: unknown, slug?: string) {
    if (perfil.rol !== 'TURISTA')
      throw new ForbiddenException(
        'La verificación está disponible para cuentas de turista.',
      );
    const codigoId =
      typeof texto === 'string' ? FORMATO_CODIGO.exec(texto)?.[1] : undefined;
    if (!codigoId)
      throw new BadRequestException(
        'El código no es un QR de visita válido de Munay.',
      );

    const origen = await this.prisma.cliente.codigoVisita.findUnique({
      where: { id: codigoId, destino: { estadoEditorial: 'publicada' } },
      select: {
        id: true,
        usadoEn: true,
        venceEn: true,
        anuladoEn: true,
        destino: {
          select: {
            ...camposDestino,
            latitud: true,
            longitud: true,
            informacion: true,
          },
        },
      },
    });
    if (!origen || (slug && origen.destino.slug !== slug)) {
      throw new BadRequestException(
        'El código no corresponde a este destino o no es válido.',
      );
    }

    const { informacion, ...destino } = origen.destino;
    if (
      informacion &&
      typeof informacion === 'object' &&
      !Array.isArray(informacion) &&
      typeof informacion.latitudIngreso === 'string' &&
      typeof informacion.longitudIngreso === 'string'
    ) {
      destino.latitud = Number(informacion.latitudIngreso);
      destino.longitud = Number(informacion.longitudIngreso);
    }
    return { ...origen, destino };
  }

  private visitaExistente(
    cliente: Prisma.TransactionClient,
    usuarioId: string,
    destinoId: string,
  ) {
    return cliente.visitaVerificada.findUnique({
      where: { usuarioId_destinoId: { usuarioId, destinoId } },
      select: camposVisita,
    });
  }

  async prepararVerificacion(perfil: Perfil, texto: unknown, slug?: string) {
    const codigo = await this.obtenerCodigo(perfil, texto, slug);
    const destino = codigo.destino;
    return this.prisma.cliente.$transaction(async (transaccion) => {
      await bloquearDestino(transaccion, destino.id);
      const visita = await this.visitaExistente(
        transaccion,
        perfil.id,
        destino.id,
      );
      if (visita)
        return {
          estado: 'verificada',
          datos: { visita, destino, yaVerificada: true },
        } as const;

      const datosPermiso = { codigoId: codigo.id, usuarioId: perfil.id };
      const ahora = new Date();
      const permiso = await transaccion.permisoVisita.findUnique({
        where: { codigoId_usuarioId: datosPermiso },
      });
      if (!permiso || permiso.venceEn <= ahora) {
        const vigente = await transaccion.codigoVisita.findUnique({
          where: { id: codigo.id },
        });
        if (!vigente)
          throw new BadRequestException('El código ya no está disponible.');
        comprobarVigencia(vigente, ahora);
        await transaccion.permisoVisita.deleteMany({
          where: { usuarioId: perfil.id, venceEn: { lte: ahora } },
        });
        await transaccion.permisoVisita.create({
          data: {
            ...datosPermiso,
            venceEn: new Date(ahora.getTime() + VIGENCIA_PERMISO_MS),
          },
        });
      }
      return {
        estado: 'ubicacion',
        destino,
        radioMetros: RADIO_VISITA_METROS,
      } as const;
    });
  }

  async verificar(
    perfil: Perfil,
    texto: unknown,
    slug?: string,
    ubicacion?: unknown,
  ) {
    const { id: codigoId, destino } = await this.obtenerCodigo(
      perfil,
      texto,
      slug,
    );
    return this.prisma.cliente.$transaction(async (transaccion) => {
      await bloquearDestino(transaccion, destino.id);
      const anterior = await this.visitaExistente(
        transaccion,
        perfil.id,
        destino.id,
      );
      if (anterior) return { visita: anterior, destino, yaVerificada: true };
      const permisoId = { codigoId, usuarioId: perfil.id };
      const permiso = await transaccion.permisoVisita.findUnique({
        where: { codigoId_usuarioId: permisoId },
      });
      const ahora = new Date();
      if (!permiso || permiso.venceEn <= ahora)
        throw new GoneException(
          'El permiso para confirmar la visita venció o no se inició. Escanea el QR vigente.',
        );
      const geocerca = validarGeocerca(destino, ubicacion);

      const visita = await transaccion.visitaVerificada.create({
        data: {
          usuarioId: perfil.id,
          destinoId: destino.id,
          codigoId,
          verificadaEn: ahora,
        },
        select: camposVisita,
      });
      await transaccion.permisoVisita.delete({
        where: { codigoId_usuarioId: permisoId },
      });
      return { visita, destino, geocerca, yaVerificada: false };
    });
  }
}
