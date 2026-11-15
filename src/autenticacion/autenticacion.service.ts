import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ServicioPrisma } from '../prisma/prisma.service.js';

const INACTIVIDAD_MAXIMA_MS = 30 * 60 * 1000;
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const camposPerfil = {
  id: true,
  nombreCompleto: true,
  rol: true,
  activo: true,
} as const;

@Injectable()
export class AutenticacionService {
  private clienteSupabase?: SupabaseClient;
  private cacheTokens = new Map<
    string,
    {
      usuario: any;
      sesionId: string;
      expiraEn: number;
    }
  >();
  private cacheActividad = new Map<string, number>();

  constructor(private readonly prisma: ServicioPrisma) {}

  async iniciarSesion(autorizacion?: string) {
    const { usuario, sesionId } = await this.verificarIdentidad(autorizacion);
    const nombre = usuario.user_metadata.nombreCompleto as unknown;
    const nombreCompleto =
      typeof nombre === 'string' && nombre.trim()
        ? nombre.trim().slice(0, 120)
        : 'Turista';

    await this.prisma.cliente.$transaction(async (transaccion) => {
      const perfil = await transaccion.usuario.upsert({
        where: { id: usuario.id },
        create: { id: usuario.id, nombreCompleto },
        update: { id: usuario.id },
        select: { activo: true },
      });

      if (!perfil.activo) {
        throw new UnauthorizedException('La cuenta no está disponible.');
      }

      await transaccion.sesionUsuario.createMany({
        data: { id: sesionId, usuarioId: usuario.id },
        skipDuplicates: true,
      });
    });

    return this.actualizarActividad(usuario.id, sesionId);
  }

  async validarSesion(autorizacion?: string) {
    const { usuario, sesionId } = await this.verificarIdentidad(autorizacion);
    return this.actualizarActividad(usuario.id, sesionId);
  }

  async cerrarSesion(autorizacion?: string) {
    const { usuario, sesionId } = await this.verificarIdentidad(autorizacion);

    const token = autorizacion?.match(/^Bearer (\S+)$/i)?.[1];
    if (token) this.cacheTokens.delete(token);
    this.cacheActividad.delete(`${usuario.id}:${sesionId}`);

    await this.prisma.cliente.sesionUsuario.updateMany({
      where: { id: sesionId, usuarioId: usuario.id, revocadaEn: null },
      data: { revocadaEn: new Date() },
    });
  }

  private async actualizarActividad(usuarioId: string, sesionId: string) {
    const ahora = new Date();
    const ahoraMs = ahora.getTime();
    const limite = new Date(ahoraMs - INACTIVIDAD_MAXIMA_MS);
    const claveActividad = `${usuarioId}:${sesionId}`;
    const ultimaGrabada = this.cacheActividad.get(claveActividad) ?? 0;
    const necesitaActualizar = ahoraMs - ultimaGrabada > 60_000;

    if (!necesitaActualizar) {
      const [perfil, sesionValida] = await Promise.all([
        this.prisma.cliente.usuario.findUnique({
          where: { id: usuarioId },
          select: camposPerfil,
        }),
        this.prisma.cliente.sesionUsuario.findFirst({
          where: {
            id: sesionId,
            usuarioId,
            revocadaEn: null,
            ultimaActividadEn: { gt: limite },
          },
          select: { id: true },
        }),
      ]);

      if (!perfil?.activo) {
        throw new UnauthorizedException('La cuenta no está disponible.');
      }
      if (!sesionValida) {
        throw new UnauthorizedException(
          'La sesión no está disponible o expiró.',
        );
      }

      return {
        perfil,
        venceEn: new Date(ahoraMs + INACTIVIDAD_MAXIMA_MS),
      };
    }

    return this.prisma.cliente.$transaction(async (transaccion) => {
      const perfil = await transaccion.usuario.findUnique({
        where: { id: usuarioId },
        select: camposPerfil,
      });

      if (!perfil?.activo) {
        throw new UnauthorizedException('La cuenta no está disponible.');
      }

      const { count } = await transaccion.sesionUsuario.updateMany({
        where: {
          id: sesionId,
          usuarioId,
          revocadaEn: null,
          ultimaActividadEn: { gt: limite },
        },
        data: { ultimaActividadEn: ahora },
      });

      if (!count) {
        throw new UnauthorizedException(
          'La sesión no está disponible o expiró.',
        );
      }

      this.cacheActividad.set(claveActividad, ahoraMs);

      return {
        perfil,
        venceEn: new Date(ahoraMs + INACTIVIDAD_MAXIMA_MS),
      };
    });
  }

  private async verificarIdentidad(autorizacion?: string) {
    const token = autorizacion?.match(/^Bearer (\S+)$/i)?.[1];

    if (!token) {
      throw new UnauthorizedException('Se requiere iniciar sesión.');
    }

    const ahora = Date.now();
    const enCache = this.cacheTokens.get(token);
    if (enCache && enCache.expiraEn > ahora) {
      return { usuario: enCache.usuario, sesionId: enCache.sesionId };
    }

    const { data, error } = await this.supabase.auth.getUser(token);

    if (error && (!error.status || error.status >= 500)) {
      throw new ServiceUnavailableException(
        'El servicio de autenticación no está disponible.',
      );
    }

    if (error || !data.user?.email_confirmed_at) {
      throw new UnauthorizedException(
        'La sesión no es válida o el correo no está confirmado.',
      );
    }

    let sesionId: unknown;

    try {
      const carga = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
      ) as { session_id?: unknown };
      sesionId = carga.session_id;
    } catch {
      throw new UnauthorizedException('La sesión no es válida.');
    }

    if (typeof sesionId !== 'string' || !UUID.test(sesionId)) {
      throw new UnauthorizedException('La sesión no es válida.');
    }

    if (this.cacheTokens.size > 200) this.cacheTokens.clear();
    this.cacheTokens.set(token, {
      usuario: data.user,
      sesionId,
      expiraEn: ahora + 60_000,
    });

    return { usuario: data.user, sesionId };
  }

  private get supabase(): SupabaseClient {
    if (!this.clienteSupabase) {
      const url = process.env.SUPABASE_URL;
      const clave = process.env.SUPABASE_PUBLISHABLE_KEY;

      if (!url || !clave) {
        throw new ServiceUnavailableException(
          'Falta configurar Supabase Auth.',
        );
      }

      this.clienteSupabase = createClient(url, clave, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
    }

    return this.clienteSupabase;
  }
}
