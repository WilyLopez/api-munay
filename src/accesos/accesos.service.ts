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

function escaparHtml(valor: string) {
  const entidades: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return valor.replace(/[&<>"']/g, (caracter) => entidades[caracter]);
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
    const valorToken = nuevo ? `${token}.nuevo` : token;
    enlace.searchParams.set('token', valorToken);
    enlace.hash = valorToken;
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
        const nombreDestino = escaparHtml(destino?.nombre ?? 'un nuevo atractivo');
        const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invitación a Munay</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8f4ea; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #173b32;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8f4ea; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 580px; background-color: #ffffff; border-radius: 20px; overflow: hidden; border: 1px solid #dce3da; box-shadow: 0 4px 16px rgba(23, 59, 50, 0.06);">
          <tr>
            <td style="background-color: #174238; padding: 32px 40px; text-align: left;">
              <span style="font-size: 26px; font-weight: 900; color: #ffffff; letter-spacing: -0.5px;">munay<span style="color: #c86a52;">.</span></span>
              <p style="margin: 6px 0 0; color: #e0eee7; font-size: 13px; letter-spacing: 0.5px; text-transform: uppercase;">Invitación oficial de gestión</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 36px 40px;">
              <h1 style="margin: 0 0 16px; font-size: 22px; font-weight: 700; color: #173b32; line-height: 1.3;">
                ${destino ? `Gestiona ${nombreDestino} en Munay` : 'Registra y administra un nuevo atractivo en Munay'}
              </h1>
              <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #465a50;">
                Has sido invitado por el equipo de administración para coordinar la presencia oficial de <strong>${nombreDestino}</strong> en la plataforma cultural de Lambayeque.
              </p>
              <div style="background-color: #f4f5ef; border-radius: 12px; padding: 18px 20px; margin-bottom: 28px; border-left: 4px solid #174238;">
                <p style="margin: 0; font-size: 13px; font-weight: 600; color: #174238; text-transform: uppercase; letter-spacing: 0.5px;">Herramientas incluidas:</p>
                <ul style="margin: 8px 0 0; padding-left: 18px; font-size: 14px; color: #465a50; line-height: 1.6;">
                  <li>Generación y control de códigos QR para visitas verificadas</li>
                  <li>Actualización de ficha de horarios, rutas y tarifas</li>
                  <li>Métricas de afluencia y atención de reseñas comunitarias</li>
                </ul>
              </div>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
                <tr>
                  <td align="center" style="border-radius: 12px; background-color: #174238;">
                    <a href="${escaparHtml(enlace.href)}" target="_blank" style="display: inline-block; padding: 14px 28px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 12px;">Aceptar invitación y configurar acceso</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0; font-size: 13px; color: #768a80; line-height: 1.5;">
                Este enlace es exclusivo para <strong>${escaparHtml(correo)}</strong> y permanecerá activo durante las próximas 72 horas.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f4f5ef; padding: 20px 40px; border-top: 1px solid #dce3da; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #768a80;">
                Munay · Plataforma de turismo y patrimonio cultural de Lambayeque, Perú.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

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
            text: `Te invitamos a ${destino ? `gestionar ${destino.nombre}` : 'registrar un nuevo atractivo'} en Munay.\n\nAccede con el correo ${correo} antes de 72 horas abriendo este enlace:\n${enlace.href}`,
            html,
          }),
        });
        enviado = respuesta.ok;
      } catch {
        enviado = false;
      }
    }
    return { enlace: enlace.href, enviado };
  }

  async consultarInvitacion(token: string) {
    const limpio = typeof token === 'string' ? token.split('.')[0] : '';
    if (!limpio || !/^[\w-]{43}$/.test(limpio)) {
      throw new BadRequestException('El enlace de invitación no es válido.');
    }
    const hash = hashToken(limpio);
    const fila = await this.prisma.cliente.accesoEncargado.findUnique({
      where: { tokenHash: hash },
      select: {
        id: true,
        tipo: true,
        estado: true,
        correo: true,
        venceEn: true,
        propuesta: true,
        destino: {
          select: {
            id: true,
            nombre: true,
            ubicacion: true,
            imagenUrl: true,
            provincia: true,
            categoria: true,
            descripcion: true,
          },
        },
      },
    });
    if (!fila) {
      throw new NotFoundException('La invitación no existe o ya no es válida.');
    }
    const vencida = Boolean(fila.venceEn && fila.venceEn <= new Date());
    const activa = fila.estado === 'pendiente' && !vencida;
    return {
      valida: activa,
      estado: fila.estado,
      vencida,
      correo: fila.correo,
      nuevo: Boolean(
        fila.propuesta &&
          typeof fila.propuesta === 'object' &&
          'alta' in fila.propuesta,
      ),
      destino: fila.destino,
      venceEn: fila.venceEn,
    };
  }

  async aceptar(persona: Persona, token: unknown, propuesta?: unknown) {
    if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token))
      throw new BadRequestException('El enlace de invitación no es válido.');
    return this.transaccion(async (tx) => {
      const fila = await tx.accesoEncargado.findUnique({
        where: { tokenHash: hashToken(token) },
      });
      if (fila?.estado === 'aprobada')
        throw new GoneException(
          'Esta invitación ya fue utilizada. Inicia sesión para entrar a tu panel.',
        );
      if (fila?.estado === 'revocada')
        throw new GoneException('Esta invitación fue revocada.');
      if (!fila || !fila.venceEn || fila.estado !== 'pendiente')
        throw new GoneException('Esta invitación ya no está disponible.');
      if (fila.venceEn <= new Date())
        throw new GoneException(
          'El enlace de invitación ha vencido. Pide al equipo de Munay un enlace nuevo.',
        );
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
