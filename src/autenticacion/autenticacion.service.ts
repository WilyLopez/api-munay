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

    await this.prisma.cliente.sesionUsuario.updateMany({
      where: { id: sesionId, usuarioId: usuario.id, revocadaEn: null },
      data: { revocadaEn: new Date() },
    });
  }

  private async actualizarActividad(usuarioId: string, sesionId: string) {
    const ahora = new Date();
    const limite = new Date(ahora.getTime() - INACTIVIDAD_MAXIMA_MS);

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

      return {
        perfil,
        venceEn: new Date(ahora.getTime() + INACTIVIDAD_MAXIMA_MS),
      };
    });
  }

  private async verificarIdentidad(autorizacion?: string) {
    const token = autorizacion?.match(/^Bearer (\S+)$/i)?.[1];

    if (!token) {
      throw new UnauthorizedException('Se requiere iniciar sesión.');
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
