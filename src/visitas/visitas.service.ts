import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, RolUsuario } from '../generated/prisma/client.js';
import { ServicioPrisma } from '../prisma/prisma.service.js';

const VIGENCIA_MS = 60_000;
const PREFIJO = 'munay:visita:';
const FORMATO_CODIGO =
  /^munay:visita:([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
const TAMANO_PAGINA = 25;
const camposDestino = { id: true, nombre: true, slug: true } as const;
const camposVisita = { id: true, verificadaEn: true } as const;
type Perfil = { id: string; rol: RolUsuario };

function alcanceAdministrador(perfil: Perfil): Prisma.DestinoWhereInput {
  if (perfil.rol === 'SUPER_ADMIN') return {};
  if (perfil.rol !== 'ADMIN_DESTINO') throw new ForbiddenException();
  return { administradores: { some: { usuarioId: perfil.id } } };
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

  async sincronizar(perfil: Perfil, slug: string, renovar: boolean) {
    const destino = await this.obtenerDestinoAdministrado(perfil, slug);
    const codigo = await this.prisma.cliente.$transaction(
      async (transaccion) => {
        await bloquearDestino(transaccion, destino.id);
        const ahora = new Date();
        const actual = await transaccion.codigoVisita.findFirst({
          where: {
            destinoId: destino.id,
            usadoEn: null,
            anuladoEn: null,
            venceEn: { gt: ahora },
          },
          orderBy: { creadoEn: 'desc' },
        });

        if (actual && !renovar) return actual;
        if (actual) {
          await transaccion.codigoVisita.update({
            where: { id: actual.id },
            data: { anuladoEn: ahora },
          });
        }
        return transaccion.codigoVisita.create({
          data: {
            destinoId: destino.id,
            creadoEn: ahora,
            venceEn: new Date(ahora.getTime() + VIGENCIA_MS),
          },
        });
      },
    );

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
        where: { destinoId: destino.id, creadaEn: { gte: desde, lte: ahora } },
        _avg: { calificacion: true },
        _count: { _all: true },
      }),
      cliente.resena.findMany({
        where: { destinoId: destino.id, creadaEn: { gte: desde, lte: ahora } },
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

  async verificar(perfil: Perfil, texto: unknown, slug?: string) {
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
      where: { id: codigoId },
      select: { destino: { select: camposDestino } },
    });
    if (!origen || (slug && origen.destino.slug !== slug)) {
      throw new BadRequestException(
        'El código no corresponde a este destino o no es válido.',
      );
    }

    const destino = origen.destino;
    return this.prisma.cliente.$transaction(async (transaccion) => {
      await bloquearDestino(transaccion, destino.id);
      const codigo = await transaccion.codigoVisita.findUnique({
        where: { id: codigoId },
      });
      if (!codigo)
        throw new BadRequestException('El código ya no está disponible.');
      const anterior = await transaccion.visitaVerificada.findUnique({
        where: {
          usuarioId_destinoId: { usuarioId: perfil.id, destinoId: destino.id },
        },
        select: camposVisita,
      });
      if (anterior) return { visita: anterior, destino, yaVerificada: true };
      if (codigo.usadoEn)
        throw new ConflictException(
          'Este QR ya fue usado. Escanea el código nuevo.',
        );

      const ahora = new Date();
      if (codigo.venceEn <= ahora)
        throw new GoneException('El QR expiró. Escanea el código vigente.');
      if (codigo.anuladoEn)
        throw new GoneException(
          'El QR fue reemplazado. Escanea el código vigente.',
        );

      const visita = await transaccion.visitaVerificada.create({
        data: {
          usuarioId: perfil.id,
          destinoId: destino.id,
          codigoId,
          verificadaEn: ahora,
        },
        select: camposVisita,
      });
      await transaccion.codigoVisita.update({
        where: { id: codigoId },
        data: { usadoEn: ahora },
      });
      return { visita, destino, yaVerificada: false };
    });
  }
}
