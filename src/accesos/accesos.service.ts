import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  CategoriaDestino,
  Prisma,
  ProvinciaDestino,
  type RolUsuario,
} from '../generated/prisma/client.js';
import { ServicioPrisma } from '../prisma/prisma.service.js';

type Persona = { id: string; correo: string; rol: RolUsuario };
const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const seleccion = {
  id: true,
  tipo: true,
  estado: true,
  correo: true,
  motivo: true,
  contacto: true,
  propuesta: true,
  creadoEn: true,
  venceEn: true,
  observacion: true,
  destino: { select: { id: true, nombre: true } },
} satisfies Prisma.AccesoEncargadoSelect;

function texto(valor: unknown, minimo: number, maximo: number, nombre: string) {
  const resultado = typeof valor === 'string' ? valor.trim() : '';
  if (resultado.length < minimo || resultado.length > maximo)
    throw new BadRequestException(
      `${nombre} debe tener entre ${minimo} y ${maximo} caracteres.`,
    );
  return resultado;
}

function propuestaValida(valor: unknown) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor))
    throw new BadRequestException('Completa los datos del nuevo atractivo.');
  const {
    nombre,
    descripcion,
    ubicacion,
    categoria,
    provincia,
    latitud,
    longitud,
  } = valor as Record<string, unknown>;
  if (
    !Object.values(CategoriaDestino).includes(categoria as CategoriaDestino) ||
    !Object.values(ProvinciaDestino).includes(provincia as ProvinciaDestino)
  ) {
    throw new BadRequestException(
      'Selecciona una categoría y una provincia válidas.',
    );
  }
  if (
    typeof latitud !== 'number' ||
    !Number.isFinite(latitud) ||
    Math.abs(latitud) > 90 ||
    typeof longitud !== 'number' ||
    !Number.isFinite(longitud) ||
    Math.abs(longitud) > 180
  ) {
    throw new BadRequestException(
      'Ingresa coordenadas válidas para el atractivo.',
    );
  }
  return {
    nombre: texto(nombre, 3, 120, 'El nombre'),
    descripcion: texto(descripcion, 20, 1000, 'La descripción'),
    ubicacion: texto(ubicacion, 4, 180, 'La ubicación'),
    categoria: categoria as CategoriaDestino,
    provincia: provincia as ProvinciaDestino,
    latitud,
    longitud,
  };
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function slugNuevo(nombre: string) {
  const base =
    nombre
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 90)
      .replace(/^-|-$/g, '') || 'atractivo';
  return `${base}-${randomUUID().slice(0, 8)}`;
}

@Injectable()
export class AccesosService {
  constructor(private readonly prisma: ServicioPrisma) {}

  private transaccion<T>(accion: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.cliente.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(173921, 8)`;
        return accion(tx);
      },
      { maxWait: 8000, timeout: 15000 },
    );
  }

  private async asignar(
    tx: Prisma.TransactionClient,
    usuarioId: string,
    destinoId: string,
    actorId: string,
  ) {
    const perfil = await tx.usuario.findUnique({
      where: { id: usuarioId },
      select: { activo: true, rol: true },
    });
    if (!perfil?.activo || perfil.rol === 'SUPER_ADMIN')
      throw new ForbiddenException(
        'La cuenta no puede recibir esta asignación.',
      );
    const existente = await tx.administradorDestino.findUnique({
      where: { usuarioId },
    });
    if (existente && existente.destinoId !== destinoId)
      throw new ConflictException(
        'Esta cuenta ya gestiona un destino. Retira la asignación anterior para continuar.',
      );
    if (perfil.rol === 'TURISTA')
      await tx.usuario.update({
        where: { id: usuarioId },
        data: { rol: 'ADMIN_DESTINO' },
      });
    const asignacion = await tx.administradorDestino.createMany({
      data: { usuarioId, destinoId },
      skipDuplicates: true,
    });
    if (asignacion.count || perfil.rol === 'TURISTA')
      await tx.auditoriaUsuario.create({
        data: {
          actorId,
          usuarioId,
          accion: 'asignar',
          cambios: {
            destinoId,
            rolAnterior: perfil.rol,
            rolNuevo: 'ADMIN_DESTINO',
          },
        },
      });
  }

  private async confirmarSuperAdmin(tx: Prisma.TransactionClient, id: string) {
    const actor = await tx.usuario.findUnique({
      where: { id },
      select: { rol: true, activo: true },
    });
    if (actor?.rol !== 'SUPER_ADMIN' || !actor.activo)
      throw new ForbiddenException();
  }

  async listar(usuarioId?: string, pagina = 1, filtro?: string) {
    const ahora = new Date();
    const where: Prisma.AccesoEncargadoWhereInput = usuarioId
      ? { usuarioId }
      : {};
    if (filtro === 'pendientes') {
      where.estado = 'pendiente';
      where.OR = [{ venceEn: null }, { venceEn: { gt: ahora } }];
    } else if (filtro === 'resueltos') {
      where.OR = [
        { estado: { not: 'pendiente' } },
        { venceEn: { lte: ahora } },
      ];
    }
    const filas = await this.prisma.cliente.accesoEncargado.findMany({
      where,
      select: seleccion,
      orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
      skip: (pagina - 1) * 25,
      take: 26,
    });
    return {
      filas: filas.slice(0, 25).map((fila) => ({
        ...fila,
        propuesta: fila.tipo === 'solicitud' ? fila.propuesta : null,
        vencida:
          fila.estado === 'pendiente' &&
          fila.venceEn !== null &&
          fila.venceEn <= ahora,
      })),
      hayMas: filas.length > 25,
    };
  }

  async solicitar(persona: Persona, entrada: Record<string, unknown>) {
    if (persona.rol === 'SUPER_ADMIN') throw new ForbiddenException();
    const motivo = texto(entrada.motivo, 15, 500, 'El motivo');
    const contacto = texto(
      entrada.contacto,
      5,
      180,
      'El contacto de referencia',
    );
    const destinoId =
      typeof entrada.destinoId === 'string' && uuid.test(entrada.destinoId)
        ? entrada.destinoId
        : null;
    const propuesta = destinoId
      ? undefined
      : propuestaValida(entrada.propuesta);
    await this.transaccion(async (tx) => {
      if (
        destinoId &&
        !(await tx.destino.findUnique({
          where: { id: destinoId },
          select: { id: true },
        }))
      ) {
        throw new NotFoundException('El atractivo ya no está disponible.');
      }
      if (
        await tx.administradorDestino.findUnique({
          where: { usuarioId: persona.id },
        })
      ) {
        throw new ConflictException('Tu cuenta ya gestiona un destino.');
      }
      if (
        await tx.accesoEncargado.findFirst({
          where: {
            usuarioId: persona.id,
            tipo: 'solicitud',
            estado: 'pendiente',
            destinoId,
          },
        })
      ) {
        throw new ConflictException(
          'Ya tienes una solicitud pendiente para esta opción.',
        );
      }
      await tx.accesoEncargado.create({
        data: {
          tipo: 'solicitud',
          correo: persona.correo,
          usuarioId: persona.id,
          destinoId,
          motivo,
          contacto,
          propuesta,
        },
      });
    });
  }

  async invitar(actorId: string, entrada: Record<string, unknown>) {
    const correo = texto(entrada.correo, 5, 254, 'El correo').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo))
      throw new BadRequestException('Ingresa un correo válido.');
    const nuevo = entrada.nuevo === true;
    if (
      !nuevo &&
      (typeof entrada.destinoId !== 'string' || !uuid.test(entrada.destinoId))
    )
      throw new BadRequestException('Selecciona un atractivo.');
    const destinoId = nuevo ? null : (entrada.destinoId as string);
    let enlace: URL;
    try {
      const base =
        process.env.MUNAY_WEB_URL ??
        (process.env.NODE_ENV === 'production' || process.env.VERCEL === '1'
          ? undefined
          : 'http://localhost:3000');
      enlace = new URL('/invitacion-encargado', base);
      if (!['https:', 'http:'].includes(enlace.protocol)) throw new Error();
    } catch {
      throw new BadRequestException(
        'Configura MUNAY_WEB_URL con la dirección del sitio web.',
      );
    }
    const token = randomBytes(32).toString('base64url');
    enlace.hash = nuevo ? `${token}.nuevo` : token;
    const venceEn = new Date(Date.now() + 72 * 60 * 60 * 1000);
    const destino = await this.transaccion(async (tx) => {
      await this.confirmarSuperAdmin(tx, actorId);
      const lugar = destinoId
        ? await tx.destino.findUnique({
            where: { id: destinoId },
            select: { nombre: true },
          })
        : null;
      if (destinoId && !lugar)
        throw new NotFoundException('El atractivo ya no está disponible.');
      await tx.accesoEncargado.updateMany({
        where: { tipo: 'invitacion', estado: 'pendiente', correo, destinoId },
        data: {
          estado: 'revocada',
          resueltoEn: new Date(),
          resueltoPor: actorId,
        },
      });
      await tx.accesoEncargado.create({
        data: {
          tipo: 'invitacion',
          correo,
          destinoId,
          propuesta: nuevo ? { alta: true } : undefined,
          tokenHash: hashToken(token),
          venceEn,
          resueltoPor: actorId,
        },
      });
      return lugar;
    });
    const { RESEND_API_KEY: clave, RESEND_REMITENTE: from } = process.env;
    let enviado = false;
    if (clave && from) {
      try {
        const respuesta = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${clave}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(5000),
          body: JSON.stringify({
            from,
            to: [correo],
            subject: 'Invitación para gestionar un atractivo en Munay',
            text: `Te invitamos a ${destino ? `gestionar ${destino.nombre}` : 'registrar un nuevo destino'} en Munay. Inicia sesión con este correo y abre el enlace para aceptar. Es válido durante 72 horas.\n\n${enlace.href}`,
          }),
        });
        enviado = respuesta.ok;
      } catch {
        enviado = false;
      }
    }
    return { enlace: enlace.href, enviado };
  }

  async aceptar(persona: Persona, token: unknown, propuesta?: unknown) {
    if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token))
      throw new BadRequestException('El enlace de invitación no es válido.');
    return this.transaccion(async (tx) => {
      const fila = await tx.accesoEncargado.findUnique({
        where: { tokenHash: hashToken(token) },
      });
      if (
        !fila ||
        !fila.venceEn ||
        fila.venceEn <= new Date() ||
        fila.estado !== 'pendiente'
      ) {
        throw new GoneException(
          'La invitación venció o ya se utilizó. Pide al equipo de Munay un enlace nuevo.',
        );
      }
      if (fila.correo !== persona.correo)
        throw new ForbiddenException(
          'Inicia sesión con el correo al que se envió esta invitación.',
        );
      let destinoId = fila.destinoId;
      if (!destinoId) {
        if (
          !fila.propuesta ||
          typeof fila.propuesta !== 'object' ||
          !('alta' in fila.propuesta) ||
          fila.propuesta.alta !== true
        )
          throw new GoneException(
            'El destino de esta invitación ya no está disponible.',
          );
        const datos = propuestaValida(propuesta);
        const { distrito } = propuesta as Record<string, unknown>;
        const destino = await tx.destino.create({
          data: {
            ...datos,
            slug: slugNuevo(datos.nombre),
            estadoEditorial: 'borrador',
            informacion: { distrito: texto(distrito, 2, 100, 'El distrito') },
          },
          select: { id: true },
        });
        destinoId = destino.id;
      }
      await this.asignar(
        tx,
        persona.id,
        destinoId,
        fila.resueltoPor ?? persona.id,
      );
      await tx.accesoEncargado.update({
        where: { id: fila.id },
        data: {
          estado: 'aprobada',
          usuarioId: persona.id,
          destinoId,
          propuesta: Prisma.DbNull,
          resueltoEn: new Date(),
        },
      });
    });
  }

  async resolver(
    id: string,
    actorId: string,
    entrada: Record<string, unknown>,
  ) {
    const { decision } = entrada;
    if (
      decision !== 'aprobar' &&
      decision !== 'rechazar' &&
      decision !== 'revocar'
    )
      throw new BadRequestException('Selecciona una decisión válida.');
    const observacion =
      decision === 'rechazar'
        ? texto(entrada.observacion, 5, 500, 'La observación')
        : null;
    await this.transaccion(async (tx) => {
      await this.confirmarSuperAdmin(tx, actorId);
      const fila = await tx.accesoEncargado.findUnique({ where: { id } });
      if (!fila) throw new NotFoundException('El registro no está disponible.');
      if (fila.estado !== 'pendiente')
        throw new ConflictException('Este registro ya se resolvió.');
      if ((decision === 'revocar') !== (fila.tipo === 'invitacion'))
        throw new BadRequestException(
          'La decisión no corresponde al registro.',
        );
      let destinoId = fila.destinoId;
      if (decision === 'aprobar') {
        if (!fila.usuarioId)
          throw new ConflictException(
            'La cuenta solicitante no está disponible.',
          );
        if (!destinoId && fila.propuesta) {
          const datos = propuestaValida(fila.propuesta);
          const destino = await tx.destino.create({
            data: {
              ...datos,
              slug: slugNuevo(datos.nombre),
              estadoEditorial: 'borrador',
            },
            select: { id: true },
          });
          destinoId = destino.id;
        }
        if (!destinoId)
          throw new ConflictException('El atractivo ya no está disponible.');
        await this.asignar(tx, fila.usuarioId, destinoId, actorId);
      }
      await tx.accesoEncargado.update({
        where: { id },
        data: {
          destinoId,
          observacion,
          resueltoEn: new Date(),
          resueltoPor: actorId,
          estado:
            decision === 'aprobar'
              ? 'aprobada'
              : decision === 'rechazar'
                ? 'rechazada'
                : 'revocada',
        },
      });
    });
  }
}
