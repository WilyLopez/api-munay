import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type RolUsuario } from '../generated/prisma/client.js';
import { ServicioPrisma } from '../prisma/prisma.service.js';

export type Filtros = Record<string, unknown>;
type Cuenta = {
  id: string;
  nombreCompleto: string;
  correo: string;
  confirmado: boolean;
  rol: RolUsuario;
  activo: boolean;
  creadaEn: Date;
  asignados: number;
};

const nombre = Prisma.sql`coalesce(u.nombre_completo, nullif(left(a.raw_user_meta_data->>'nombreCompleto', 120), ''), 'Usuario')`;
const rol = Prisma.sql`coalesce(u.rol, 'TURISTA'::munay.rol_usuario)`;
const activo = Prisma.sql`coalesce(u.activo, true)`;
const origen = Prisma.sql`FROM auth.users a LEFT JOIN munay.usuarios u ON a.id = u.id`;
const columnas = Prisma.sql`a.id, ${nombre} as "nombreCompleto", a.email as correo,
  a.email_confirmed_at is not null as confirmado, ${rol} as rol, ${activo} as activo,
  a.created_at as "creadaEn", (select count(*)::int from munay.administradores_destinos d where d.usuario_id = a.id) as asignados`;

function fecha(valor: unknown) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor))
    return null;
  const dia = new Date(`${valor}T00:00:00-05:00`);
  return Number.isFinite(dia.getTime()) && dia.toISOString().startsWith(valor)
    ? dia
    : null;
}

@Injectable()
export class UsuariosService {
  constructor(private readonly prisma: ServicioPrisma) {}

  async listar(f: Filtros) {
    const limite = [10, 20, 50].includes(Number(f.limite))
      ? Number(f.limite)
      : 20;
    const solicitada = Number(f.pagina);
    const pagina =
      Number.isSafeInteger(solicitada) && solicitada > 0 ? solicitada : 1;
    const condiciones = [
      f.vista === 'super'
        ? Prisma.sql`${rol} = 'SUPER_ADMIN'`
        : Prisma.sql`${rol} <> 'SUPER_ADMIN'`,
    ];
    if (
      f.vista !== 'super' &&
      (f.rol === 'TURISTA' || f.rol === 'ADMIN_DESTINO')
    )
      condiciones.push(Prisma.sql`${rol}::text = ${f.rol}`);
    if (f.estado === 'activo' || f.estado === 'inactivo')
      condiciones.push(Prisma.sql`${activo} = ${f.estado === 'activo'}`);
    if (f.correo === 'confirmado' || f.correo === 'pendiente')
      condiciones.push(
        Prisma.sql`(a.email_confirmed_at is not null) = ${f.correo === 'confirmado'}`,
      );
    if (typeof f.buscar === 'string' && f.buscar.trim()) {
      const termino = f.buscar.trim().slice(0, 120).toLowerCase();
      condiciones.push(
        Prisma.sql`(strpos(lower(${nombre}), ${termino}) > 0 or strpos(lower(a.email), ${termino}) > 0)`,
      );
    }
    const desde = fecha(f.desde);
    const hasta = fecha(f.hasta);
    if (desde) condiciones.push(Prisma.sql`a.created_at >= ${desde}`);
    if (hasta)
      condiciones.push(
        Prisma.sql`a.created_at < ${new Date(hasta.getTime() + 86400000)}`,
      );
    if (f.vista !== 'super' && typeof f.destino === 'string' && f.destino) {
      condiciones.push(
        Prisma.sql`exists (select 1 from munay.administradores_destinos d where d.usuario_id = a.id and d.destino_id::text = ${f.destino})`,
      );
    }
    const consulta = Prisma.sql`${origen} WHERE a.email is not null AND ${Prisma.join(condiciones, ' AND ')}`;
    const [resultado] = await this.prisma.cliente.$queryRaw<{
      total: number;
      pagina: number;
      usuarios: (Omit<Cuenta, 'creadaEn'> & { creadaEn: string })[];
    }[]>`
      with conteo as (select count(*)::int as total ${consulta}),
      pagina as (
        select total, least(${pagina}, greatest(1, ceil(total::numeric / ${limite})))::int as actual
        from conteo
      )
      select p.total, p.actual as pagina, coalesce((
        select jsonb_agg(to_jsonb(fila) order by fila."creadaEn" desc, fila.id desc)
        from (
          select ${columnas} ${consulta}
          order by a.created_at desc, a.id desc
          limit ${limite} offset ((p.actual - 1) * ${limite})
        ) fila
      ), '[]'::jsonb) as usuarios
      from pagina p`;
    return { ...resultado, limite };
  }

  destinos() {
    return this.prisma.cliente.destino.findMany({
      select: { id: true, nombre: true, slug: true },
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
    });
  }

  private async cuenta(tx: Prisma.TransactionClient, id: string) {
    const [usuario] = await tx.$queryRaw<
      Cuenta[]
    >`select ${columnas} ${origen} where a.id = ${id}::uuid and a.email is not null`;
    if (!usuario)
      throw new NotFoundException('La cuenta ya no está disponible.');
    return usuario;
  }

  async detalle(id: string) {
    const cliente = this.prisma.cliente;
    const cuenta = await this.cuenta(cliente, id);
    const [destinos, visitas, resenas, historial] = await Promise.all([
      cuenta.rol === 'ADMIN_DESTINO'
        ? cliente.destino.findMany({
            where: { administradores: { some: { usuarioId: id } } },
            select: { id: true, nombre: true, slug: true },
            orderBy: { nombre: 'asc' },
          })
        : [],
      cuenta.rol === 'TURISTA'
        ? cliente.visitaVerificada.count({ where: { usuarioId: id } })
        : 0,
      cuenta.rol === 'TURISTA'
        ? cliente.resena.count({ where: { usuarioId: id } })
        : 0,
      cliente.auditoriaUsuario.findMany({
        where: { usuarioId: id },
        orderBy: [{ creadaEn: 'desc' }, { id: 'desc' }],
        take: 20,
      }),
    ]);
    return { ...cuenta, destinos, visitas, resenas, historial };
  }

  async cambiar(actorId: string, id: string, entrada: unknown) {
    if (!entrada || typeof entrada !== 'object')
      throw new BadRequestException('Indica qué deseas actualizar.');
    const { accion, valor } = entrada as { accion?: unknown; valor?: unknown };
    return this.prisma.cliente.$transaction(async (tx) => {
      await tx.$executeRaw`select pg_advisory_xact_lock(173921, 8)`;
      const actor = await tx.usuario.findUnique({
        where: { id: actorId },
        select: { activo: true, rol: true },
      });
      if (!actor?.activo || actor.rol !== 'SUPER_ADMIN')
        throw new ForbiddenException();
      const cuenta = await this.cuenta(tx, id);
      const perfil = await tx.usuario.upsert({
        where: { id },
        create: { id, nombreCompleto: cuenta.nombreCompleto },
        update: {},
      });
      if (actorId === id && accion !== 'nombre')
        throw new BadRequestException(
          'Solo puedes editar tu nombre desde esta sección.',
        );

      let cambios: Prisma.InputJsonObject;
      if (
        accion === 'nombre' &&
        typeof valor === 'string' &&
        valor.trim().length >= 2 &&
        valor.trim().length <= 120
      ) {
        const nuevo = valor.trim();
        if (nuevo === perfil.nombreCompleto) return;
        await tx.usuario.update({
          where: { id },
          data: { nombreCompleto: nuevo },
        });
        cambios = { anterior: perfil.nombreCompleto, nuevo };
      } else if (
        accion === 'rol' &&
        (valor === 'TURISTA' ||
          valor === 'ADMIN_DESTINO' ||
          valor === 'SUPER_ADMIN')
      ) {
        if (valor === perfil.rol) return;
        await tx.usuario.update({ where: { id }, data: { rol: valor } });
        if (perfil.rol === 'ADMIN_DESTINO')
          await tx.administradorDestino.deleteMany({
            where: { usuarioId: id },
          });
        cambios = { anterior: perfil.rol, nuevo: valor };
      } else if (accion === 'estado' && typeof valor === 'boolean') {
        if (valor === perfil.activo) return;
        await tx.usuario.update({ where: { id }, data: { activo: valor } });
        if (!valor)
          await tx.sesionUsuario.updateMany({
            where: { usuarioId: id, revocadaEn: null },
            data: { revocadaEn: new Date() },
          });
        cambios = { anterior: perfil.activo, nuevo: valor };
      } else if (
        (accion === 'asignar' || accion === 'retirar') &&
        typeof valor === 'string' &&
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(valor)
      ) {
        if (
          perfil.rol !== 'ADMIN_DESTINO' ||
          (accion === 'asignar' && !perfil.activo)
        )
          throw new BadRequestException(
            'Esta acción requiere una cuenta administradora válida.',
          );
        const destino = await tx.destino.findUnique({
          where: { id: valor },
          select: { nombre: true },
        });
        if (!destino)
          throw new NotFoundException('El destino ya no está disponible.');
        const data = { usuarioId: id, destinoId: valor };
        const resultado =
          accion === 'asignar'
            ? await tx.administradorDestino.createMany({
                data,
                skipDuplicates: true,
              })
            : await tx.administradorDestino.deleteMany({ where: data });
        if (!resultado.count) return;
        cambios = { destino: destino.nombre, destinoId: valor };
      } else {
        throw new BadRequestException('Revisa el valor antes de guardar.');
      }
      await tx.auditoriaUsuario.create({
        data: { actorId, usuarioId: id, accion, cambios },
      });
    });
  }
}
