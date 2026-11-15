import { ForbiddenException } from '@nestjs/common';
import type { Prisma, RolUsuario } from '../generated/prisma/client.js';

export type PerfilConRol = { id: string; rol: RolUsuario };

export function alcanceAdministrador(
  perfil: PerfilConRol,
): Prisma.DestinoWhereInput {
  if (perfil.rol === 'SUPER_ADMIN') return {};
  if (perfil.rol !== 'ADMIN_DESTINO') throw new ForbiddenException();
  return { administradores: { some: { usuarioId: perfil.id } } };
}
