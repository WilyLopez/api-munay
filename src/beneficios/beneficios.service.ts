import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  configuracionBeneficio,
  estadoBeneficio,
  filtroEstado,
  validarHorarioUso,
} from './configuracion-beneficio.js';
import { randomBytes } from 'node:crypto';
import { ServicioPrisma } from '../prisma/prisma.service.js';
import {
  alcanceAdministrador,
  type PerfilConRol,
} from '../autenticacion/alcance-administrador.js';
import type { Prisma } from '../generated/prisma/client.js';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const destinoPublico = {
  select: { id: true, nombre: true, slug: true },
} as const;
const comprobante = {
  beneficio: { select: { destino: destinoPublico } },
} as const;
export function datosBeneficio(valor: unknown) {
  if (!valor || typeof valor !== 'object')
    throw new BadRequestException('Completa los datos del beneficio.');
  const datos = valor as Record<string, unknown>;
  const texto = (campo: string, minimo: number, maximo: number) => {
    const resultado =
      typeof datos[campo] === 'string' ? datos[campo].trim() : '';
    if (resultado.length < minimo || resultado.length > maximo)
      throw new BadRequestException(
        `Revisa el campo ${campo}: usa entre ${minimo} y ${maximo} caracteres.`,
      );
    return resultado;
  };
  if (typeof datos.destinoId !== 'string' || !UUID.test(datos.destinoId))
    throw new BadRequestException('Selecciona un atractivo válido.');
  if (!['GASTRONOMIA', 'EXPERIENCIAS'].includes(String(datos.categoria)))
    throw new BadRequestException('Selecciona una categoría válida.');
  for (const campo of ['costo', 'disponibles'])
    if (
      typeof datos[campo] !== 'number' ||
      !Number.isInteger(datos[campo]) ||
      datos[campo] < (campo === 'costo' ? 1 : 0) ||
      datos[campo] > 1000000
    )
      throw new BadRequestException(`El campo ${campo} no es válido.`);
  const venceEn = new Date(
    typeof datos.venceEn === 'string' ? datos.venceEn : '',
  );
  if (!Number.isFinite(venceEn.getTime()) || venceEn <= new Date())
    throw new BadRequestException('La vigencia debe ser una fecha futura.');
  return {
    destinoId: datos.destinoId,
    nombre: texto('nombre', 3, 120),
    local: texto('local', 3, 120),
    condiciones: texto('condiciones', 15, 2000),
    horario: texto('horario', 3, 200),
    categoria: String(datos.categoria),
    costo: datos.costo as number,
    disponibles: datos.disponibles as number,
    ...configuracionBeneficio(datos, venceEn),
    venceEn,
  };
}

@Injectable()
export class BeneficiosService {
  constructor(private readonly prisma: ServicioPrisma) {}

  async listar(
    perfil: PerfilConRol,
    filtros: {
      categoria?: string;
      destino?: string;
      orden?: string;
      pagina: number;
      estado?: string;
      buscar?: string;
    },
    administracion = false,
  ) {
    if (!administracion && perfil.rol !== 'TURISTA')
      throw new ForbiddenException(
        'Los canjes están disponibles para visitantes.',
      );
    const alcance = administracion
      ? alcanceAdministrador(perfil)
      : { estadoEditorial: 'publicada' };
    const where: Prisma.BeneficioWhereInput = {
      ...filtroEstado(administracion ? filtros.estado : undefined),
      ...(filtros.buscar && {
        OR: [
          {
            nombre: {
              contains: filtros.buscar.slice(0, 120),
              mode: 'insensitive',
            },
          },
          {
            local: {
              contains: filtros.buscar.slice(0, 120),
              mode: 'insensitive',
            },
          },
        ],
      }),
      destino: {
        ...alcance,
        ...(filtros.destino && { slug: filtros.destino }),
      },
      ...(!administracion && {
        activo: true,
        iniciaEn: { lte: new Date() },
        venceEn: { gt: new Date() },
      }),
      ...(['GASTRONOMIA', 'EXPERIENCIAS'].includes(filtros.categoria ?? '') && {
        categoria: filtros.categoria,
      }),
    };
    const [filas, total, movimientos, destinos] = await Promise.all([
      this.prisma.cliente.beneficio.findMany({
        where,
        include: { destino: destinoPublico },
        orderBy:
          filtros.orden === 'costo'
            ? [{ costo: 'asc' }, { id: 'asc' }]
            : [{ creadoEn: 'desc' }, { id: 'desc' }],
        skip: (filtros.pagina - 1) * 12,
        take: 12,
      }),
      this.prisma.cliente.beneficio.count({ where }),
      this.prisma.cliente.movimientoPuntos.aggregate({
        where: { usuarioId: perfil.id },
        _sum: { puntos: true },
      }),
      this.prisma.cliente.destino.findMany({
        where: alcance,
        select: { id: true, nombre: true, slug: true },
        orderBy: { nombre: 'asc' },
      }),
    ]);
    return {
      beneficios: filas.map((fila) => ({
        ...fila,
        estadoVista: estadoBeneficio(fila),
      })),
      total,
      hayMas: filtros.pagina * 12 < total,
      saldo: movimientos._sum.puntos ?? 0,
      usuarioId: perfil.id,
      destinos,
    };
  }

  async guardar(perfil: PerfilConRol, valor: unknown, id?: string) {
    const alcance = alcanceAdministrador(perfil);
    const datos = datosBeneficio(valor);
    const entrada = valor as Record<string, unknown>;
    const destino = await this.prisma.cliente.destino.findFirst({
      where: { ...alcance, id: datos.destinoId },
      select: { id: true, estadoEditorial: true },
    });
    if (!destino)
      throw new ForbiddenException(
        'Solo puedes gestionar beneficios de tu atractivo asignado.',
      );
    const estado =
      entrada.estado === 'borrador'
        ? 'borrador'
        : perfil.rol === 'SUPER_ADMIN' && entrada.activo === true
          ? 'publicado'
          : 'pendiente';
    const activo = estado === 'publicado';
    if (activo && destino.estadoEditorial !== 'publicada')
      throw new BadRequestException(
        'Primero publica el atractivo para ofrecer este beneficio.',
      );
    return this.prisma.cliente.$transaction(async (tx) => {
      let anterior: {
        destinoId: string;
        revision: number;
        costo: number;
        disponibles: number;
        estado: string;
      } | null = null;
      if (id) {
        anterior = await tx.beneficio.findFirst({
          where: { id, destino: alcance },
          select: {
            destinoId: true,
            revision: true,
            costo: true,
            disponibles: true,
            estado: true,
          },
        });
        if (!anterior || anterior.destinoId !== datos.destinoId)
          throw new NotFoundException(
            'El beneficio no está disponible para tu cuenta.',
          );
        if (
          !Number.isInteger(entrada.revision) ||
          !Number.isInteger(entrada.stockActual)
        )
          throw new ConflictException(
            'Actualiza el beneficio antes de editarlo.',
          );
        const revision = entrada.revision as number;
        const resultado = await tx.beneficio.updateMany({
          where: {
            id,
            revision,
            disponibles: entrada.stockActual as number,
            destino: alcance,
          },
          data: {
            ...datos,
            activo,
            estado,
            revision: { increment: 1 },
            aprobadoEn: activo ? new Date() : null,
            aprobadoRevision: activo ? revision + 1 : null,
          },
        });
        if (!resultado.count)
          throw new ConflictException(
            'El beneficio o sus cupos cambiaron mientras editabas. Actualiza y revisa las unidades antes de guardar.',
          );
      } else {
        const creado = await tx.beneficio.create({
          data: {
            ...datos,
            activo,
            estado,
            aprobadoEn: activo ? new Date() : null,
            aprobadoRevision: activo ? 1 : null,
          },
          select: { id: true },
        });
        id = creado.id;
      }
      await tx.auditoriaBeneficio.create({
        data: {
          beneficioId: id!,
          actorId: perfil.id,
          accion: activo ? 'aprobar' : anterior ? 'editar' : 'crear',
          cambios: {
            antes: anterior
              ? {
                  revision: anterior.revision,
                  costo: anterior.costo,
                  disponibles: anterior.disponibles,
                  estado: anterior.estado,
                }
              : null,
            despues: {
              ...datos,
              iniciaEn: datos.iniciaEn.toISOString(),
              venceEn: datos.venceEn.toISOString(),
              estado,
            },
          },
        },
      });
      return { id: id! };
    });
  }

  async cambiarEstado(
    perfil: PerfilConRol,
    id: string,
    accion: unknown,
    revision: unknown,
  ) {
    const alcance = alcanceAdministrador(perfil);
    if (
      !['pausar', 'reanudar'].includes(String(accion)) ||
      !Number.isInteger(revision)
    )
      throw new BadRequestException('La acción no es válida.');
    return this.prisma.cliente.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM munay.beneficios WHERE id = ${id}::uuid FOR UPDATE`;
      const oferta = await tx.beneficio.findFirst({
        where: { id, destino: alcance },
        include: { destino: { select: { estadoEditorial: true } } },
      });
      if (!oferta)
        throw new NotFoundException(
          'El beneficio no está disponible para tu cuenta.',
        );
      if (oferta.revision !== revision)
        throw new ConflictException(
          'La oferta cambió. Actualiza antes de continuar.',
        );
      const reanudar = accion === 'reanudar';
      if (
        reanudar &&
        (oferta.aprobadoRevision !== oferta.revision || !oferta.aprobadoEn)
      )
        throw new ForbiddenException(
          'El SuperAdmin debe aprobar esta versión antes de publicarla.',
        );
      if (
        reanudar &&
        (oferta.venceEn <= new Date() ||
          oferta.destino.estadoEditorial !== 'publicada')
      )
        throw new BadRequestException(
          'Revisa la vigencia y la publicación del atractivo antes de reanudar.',
        );
      await tx.beneficio.update({
        where: { id },
        data: {
          activo: reanudar,
          estado: reanudar ? 'publicado' : 'pausado',
          revision: { increment: 1 },
          aprobadoRevision:
            oferta.aprobadoRevision === oferta.revision
              ? oferta.revision + 1
              : oferta.aprobadoRevision,
        },
      });
      await tx.auditoriaBeneficio.create({
        data: {
          beneficioId: id,
          actorId: perfil.id,
          accion: reanudar ? 'reanudar' : 'pausar',
          cambios: {
            antes: oferta.estado,
            despues: reanudar ? 'publicado' : 'pausado',
            revision: oferta.revision,
          },
        },
      });
      return { id };
    });
  }

  async canjear(
    perfil: PerfilConRol,
    beneficioId: unknown,
    solicitudId: unknown,
    esperado: { costo?: unknown; version?: unknown },
  ) {
    if (perfil.rol !== 'TURISTA')
      throw new ForbiddenException(
        'Solo los visitantes pueden canjear puntos.',
      );
    if (
      typeof beneficioId !== 'string' ||
      !UUID.test(beneficioId) ||
      typeof solicitudId !== 'string' ||
      !UUID.test(solicitudId)
    )
      throw new BadRequestException('La solicitud no es válida.');
    return this.prisma.cliente.$transaction(
      async (tx) => {
        // Todos los canjes de la misma cuenta comparten este bloqueo, incluso entre beneficios distintos.
        await tx.$queryRaw`SELECT id FROM munay.usuarios WHERE id = ${perfil.id}::uuid FOR UPDATE`;
        const anterior = await tx.canjeBeneficio.findUnique({
          where: { id: solicitudId },
          include: comprobante,
        });
        if (anterior) {
          if (
            anterior.usuarioId !== perfil.id ||
            anterior.beneficioId !== beneficioId
          )
            throw new ConflictException('Esta solicitud ya fue utilizada.');
          return this.serializarComprobante(anterior, tx);
        }
        await tx.$queryRaw`SELECT id FROM munay.beneficios WHERE id = ${beneficioId}::uuid FOR UPDATE`;
        const beneficio = await tx.beneficio.findFirst({
          where: {
            id: beneficioId,
            activo: true,
            destino: { estadoEditorial: 'publicada' },
          },
        });
        if (
          !beneficio ||
          beneficio.venceEn <= new Date() ||
          (beneficio.iniciaEn && beneficio.iniciaEn > new Date()) ||
          beneficio.disponibles <= 0
        )
          throw new ConflictException(
            'Este beneficio ya no está disponible o su vigencia terminó.',
          );
        if (
          esperado.costo !== beneficio.costo ||
          esperado.version !== beneficio.revision
        )
          throw new ConflictException(
            'El beneficio cambió. Actualiza la página y revisa el costo y las condiciones antes de confirmar.',
          );
        if (
          (beneficio.limitePorPersona ?? (beneficio.unUso ? 1 : null)) !==
            null &&
          (await tx.canjeBeneficio.count({
            where: { usuarioId: perfil.id, beneficioId },
          })) >= (beneficio.limitePorPersona ?? 1)
        )
          throw new ConflictException(
            beneficio.limitePorPersona && beneficio.limitePorPersona > 1
              ? `Este beneficio permite ${beneficio.limitePorPersona} canjes por persona.`
              : 'Este beneficio permite un solo canje por persona.',
          );
        const saldo = await tx.movimientoPuntos.aggregate({
          where: { usuarioId: perfil.id },
          _sum: { puntos: true },
        });
        if ((saldo._sum.puntos ?? 0) < beneficio.costo)
          throw new BadRequestException(
            `Te faltan ${beneficio.costo - (saldo._sum.puntos ?? 0)} puntos para este beneficio.`,
          );
        const canje = await tx.canjeBeneficio.create({
          data: {
            id: solicitudId,
            beneficioId,
            usuarioId: perfil.id,
            codigo: randomBytes(16).toString('hex').toUpperCase(),
            costo: beneficio.costo,
            nombre: beneficio.nombre,
            local: beneficio.local,
            condiciones: beneficio.condiciones,
            horario: beneficio.horario,
            detalle: {
              tipo: beneficio.tipo ?? 'EXPERIENCIA',
              valor: beneficio.valor ?? null,
              limitePorPersona: beneficio.limitePorPersona ?? null,
              dias: beneficio.dias ?? [],
              horaInicio: beneficio.horaInicio ?? null,
              horaFin: beneficio.horaFin ?? null,
              consumoMinimo: beneficio.consumoMinimo ?? 0,
              exclusiones: beneficio.exclusiones ?? '',
              reservaPrevia: beneficio.reservaPrevia ?? false,
              acumulable: beneficio.acumulable ?? false,
            },
            venceEn: beneficio.venceEn,
          },
          include: comprobante,
        });
        await tx.beneficio.update({
          where: { id: beneficioId },
          data: { disponibles: { decrement: 1 } },
        });
        await tx.movimientoPuntos.create({
          data: {
            usuarioId: perfil.id,
            canjeId: canje.id,
            tipo: 'canje',
            puntos: -beneficio.costo,
          },
        });
        return this.serializarComprobante(canje, tx);
      },
      { timeout: 15000 },
    );
  }

  private async serializarComprobante(
    canje: Prisma.CanjeBeneficioGetPayload<{ include: typeof comprobante }>,
    tx: Prisma.TransactionClient,
    saldoActual?: number,
  ) {
    const saldo =
      saldoActual ??
      (
        await tx.movimientoPuntos.aggregate({
          where: { usuarioId: canje.usuarioId },
          _sum: { puntos: true },
        })
      )._sum.puntos ??
      0;
    const {
      usuarioId: _usuario,
      usadoPor: _actor,
      beneficio,
      ...datos
    } = canje;
    return {
      ...datos,
      destino: beneficio.destino,
      saldo,
      estado: canje.usadoEn
        ? 'usado'
        : canje.venceEn <= new Date()
          ? 'vencido'
          : 'disponible',
    };
  }

  async misCanjes(perfil: PerfilConRol, pagina: number) {
    if (perfil.rol !== 'TURISTA') throw new ForbiddenException();
    const filas = await this.prisma.cliente.canjeBeneficio.findMany({
      where: { usuarioId: perfil.id },
      include: comprobante,
      orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
      skip: (pagina - 1) * 12,
      take: 13,
    });
    const saldo = await this.prisma.cliente.movimientoPuntos.aggregate({
      where: { usuarioId: perfil.id },
      _sum: { puntos: true },
    });
    return {
      canjes: await Promise.all(
        filas
          .slice(0, 12)
          .map((fila) =>
            this.serializarComprobante(
              fila,
              this.prisma.cliente,
              saldo._sum.puntos ?? 0,
            ),
          ),
      ),
      hayMas: filas.length > 12,
    };
  }

  async indicadores(perfil: PerfilConRol) {
    const alcance = alcanceAdministrador(perfil);
    const destino = { destino: alcance };
    const [activos, pendientes, entregados, totalCanjes] = await Promise.all([
      this.prisma.cliente.beneficio.count({
        where: { ...destino, ...filtroEstado('publicado') },
      }),
      this.prisma.cliente.canjeBeneficio.count({
        where: {
          beneficio: destino,
          usadoEn: null,
          venceEn: { gt: new Date() },
        },
      }),
      this.prisma.cliente.canjeBeneficio.count({
        where: { beneficio: destino, usadoEn: { not: null } },
      }),
      this.prisma.cliente.canjeBeneficio.count({
        where: { beneficio: destino },
      }),
    ]);
    return { activos, pendientes, entregados, totalCanjes };
  }

  async canjesRecibidos(
    perfil: PerfilConRol,
    pagina: number,
    estado?: string,
    buscar?: string,
  ) {
    const alcance = alcanceAdministrador(perfil);
    const where: Prisma.CanjeBeneficioWhereInput = {
      beneficio: { destino: alcance },
      ...(estado === 'vigentes' && {
        usadoEn: null,
        venceEn: { gt: new Date() },
      }),
      ...(estado === 'usados' && { usadoEn: { not: null } }),
      ...(estado === 'vencidos' && {
        usadoEn: null,
        venceEn: { lte: new Date() },
      }),
      ...(buscar && {
        OR: [
          { nombre: { contains: buscar.slice(0, 120), mode: 'insensitive' } },
          { codigo: { endsWith: buscar.slice(0, 32).toUpperCase() } },
        ],
      }),
    };
    const [filas, total] = await Promise.all([
      this.prisma.cliente.canjeBeneficio.findMany({
        where,
        select: {
          id: true,
          codigo: true,
          nombre: true,
          local: true,
          costo: true,
          creadoEn: true,
          venceEn: true,
          usadoEn: true,
          usuario: { select: { nombreCompleto: true } },
        },
        orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
        skip: (pagina - 1) * 12,
        take: 12,
      }),
      this.prisma.cliente.canjeBeneficio.count({ where }),
    ]);
    const entregas = filas.length
      ? await this.prisma.cliente.auditoriaBeneficio.findMany({
          where: {
            accion: 'entregar',
            canjeId: { in: filas.map(({ id }) => id) },
            beneficio: { destino: alcance },
          },
          select: {
            canjeId: true,
            actor: { select: { nombreCompleto: true } },
          },
        })
      : [];
    return {
      canjes: filas.map(({ codigo, ...fila }) => ({
        ...fila,
        codigoParcial: `…${codigo.slice(-8)}`,
        confirmadoPor:
          entregas.find((e) => e.canjeId === fila.id)?.actor.nombreCompleto ??
          null,
        estado: fila.usadoEn
          ? 'usado'
          : fila.venceEn <= new Date()
            ? 'vencido'
            : 'vigente',
      })),
      total,
      hayMas: pagina * 12 < total,
    };
  }

  async historialCambios(
    perfil: PerfilConRol,
    beneficioId: string,
    pagina: number,
  ) {
    const alcance = alcanceAdministrador(perfil);
    const beneficio = await this.prisma.cliente.beneficio.findFirst({
      where: { id: beneficioId, destino: alcance },
      select: { id: true },
    });
    if (!beneficio)
      throw new NotFoundException(
        'El beneficio no está disponible para tu cuenta.',
      );
    const filas = await this.prisma.cliente.auditoriaBeneficio.findMany({
      where: { beneficioId, beneficio: { destino: alcance } },
      select: {
        id: true,
        accion: true,
        cambios: true,
        creadaEn: true,
        actor: { select: { nombreCompleto: true } },
      },
      orderBy: [{ creadaEn: 'desc' }, { id: 'desc' }],
      skip: (pagina - 1) * 12,
      take: 13,
    });
    return { registros: filas.slice(0, 12), hayMas: filas.length > 12 };
  }

  async usar(perfil: PerfilConRol, codigo: unknown, confirmar: boolean) {
    const alcance = alcanceAdministrador(perfil);
    if (typeof codigo !== 'string' || !/^[A-F0-9]{32}$/.test(codigo))
      throw new BadRequestException('Introduce un código de canje válido.');
    return this.prisma.cliente.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM munay.canjes_beneficios WHERE codigo = ${codigo} FOR UPDATE`;
      const canje = await tx.canjeBeneficio.findFirst({
        where: { codigo, beneficio: { destino: alcance } },
        include: comprobante,
      });
      if (!canje)
        throw new NotFoundException(
          'El comprobante no está disponible para tu atractivo.',
        );
      if (canje.usadoEn)
        throw new ConflictException('Este comprobante ya fue utilizado.');
      if (canje.venceEn <= new Date())
        throw new ConflictException('El comprobante ya venció.');
      let aviso: string | null = null;
      try {
        validarHorarioUso(canje.detalle);
      } catch (error) {
        if (!(error instanceof BadRequestException) || confirmar) throw error;
        aviso = error.message;
      }
      if (confirmar) {
        await tx.canjeBeneficio.update({
          where: { id: canje.id },
          data: { usadoEn: new Date(), usadoPor: perfil.id },
        });
        await tx.auditoriaBeneficio.create({
          data: {
            beneficioId: canje.beneficioId,
            actorId: perfil.id,
            accion: 'entregar',
            canjeId: canje.id,
            cambios: { estado: 'usado' },
          },
        });
      }
      return {
        nombre: canje.nombre,
        local: canje.local,
        condiciones: canje.condiciones,
        detalle: canje.detalle,
        venceEn: canje.venceEn,
        estado: confirmar ? 'usado' : 'disponible',
        puedeEntregar: !confirmar && aviso === null,
        aviso,
      };
    });
  }
}
