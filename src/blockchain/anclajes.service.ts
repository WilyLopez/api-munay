import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { ServicioPrisma } from '../prisma/prisma.service.js';
import type { Address, Hex } from 'viem';
import { huellaResena } from './huella-resena.js';
import { configurarSepolia, verificarRegistroSepolia } from './red-sepolia.js';

const intentosMaximos = 5;
const ordenAuditoria = [
  { creadoEn: 'desc' },
  { resenaId: 'desc' },
] satisfies Prisma.AnclajeResenaOrderByWithRelationInput[];
const seleccionAuditoria = {
  resenaId: true,
  huella: true,
  estado: true,
  transaccion: true,
  bloque: true,
  creadoEn: true,
  error: true,
  resena: {
    select: {
      usuarioId: true,
      calificacion: true,
      destino: { select: { nombre: true } },
    },
  },
} satisfies Prisma.AnclajeResenaSelect;

function filtrosAuditoria(
  estado: unknown,
  buscar: unknown,
): Prisma.AnclajeResenaWhereInput {
  const where: Prisma.AnclajeResenaWhereInput = {};
  if (estado === 'pendientes') where.estado = { in: ['pendiente', 'enviado'] };
  else if (estado === 'confirmado' || estado === 'fallido')
    where.estado = estado;
  const termino = typeof buscar === 'string' ? buscar.trim().slice(0, 80) : '';
  if (termino) {
    where.OR = [
      { huella: { contains: termino, mode: 'insensitive' } },
      { transaccion: { contains: termino, mode: 'insensitive' } },
    ];
    if (/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(termino)) {
      where.OR.push({ resena: { usuarioId: termino } });
    }
  }
  return where;
}

function filaCsv(valores: (string | number | null)[]) {
  return (
    valores
      .map((valor) => {
        const texto = String(valor ?? '');
        const protegido = /^[\t\r\n]|^[\s\uFEFF]*[=+\-@]/u.test(texto)
          ? `'${texto}`
          : texto;
        return `"${protegido.replaceAll('"', '""')}"`;
      })
      .join(',') + '\r\n'
  );
}

@Injectable()
export class AnclajesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnclajesService.name);
  private readonly red = configurarSepolia();
  private reloj?: ReturnType<typeof setInterval>;
  private ocupado = false;

  constructor(private readonly prisma: ServicioPrisma) {}

  async verificarPublico(id: string) {
    const resena = await this.prisma.cliente.resena.findFirst({
      where: { id, retiradaEn: null },
      select: {
        id: true,
        destinoId: true,
        calificacion: true,
        comentario: true,
        destino: { select: { slug: true, nombre: true } },
        anclaje: {
          select: {
            huella: true,
            transaccion: true,
            contrato: true,
            estado: true,
            bloque: true,
          },
        },
      },
    });
    if (!resena) throw new NotFoundException('La reseña no está disponible.');
    const { anclaje, destino } = resena;
    if (
      anclaje?.estado !== 'confirmado' ||
      !anclaje.contrato ||
      !anclaje.transaccion
    ) {
      return { estado: 'pendiente', destino };
    }
    const evidencia = {
      destino,
      huella: anclaje.huella,
      transaccion: anclaje.transaccion,
      bloque: anclaje.bloque,
    };
    if (huellaResena(resena) !== anclaje.huella)
      return { ...evidencia, estado: 'no-coincide' };
    try {
      const estado = await verificarRegistroSepolia(
        anclaje.transaccion as Hex,
        anclaje.huella as Hex,
        anclaje.contrato as Address,
      );
      return { ...evidencia, estado };
    } catch {
      throw new ServiceUnavailableException(
        'No pudimos consultar Sepolia. Intenta nuevamente.',
      );
    }
  }

  onModuleInit() {
    if (!this.red || process.env.VERCEL === '1') return;
    this.reloj = setInterval(() => void this.procesar(), 12000);
    this.reloj.unref();
  }

  onModuleDestroy() {
    clearInterval(this.reloj);
  }

  async procesar() {
    const red = this.red;
    if (!red) return 'deshabilitado';
    if (this.ocupado) return 'ocupado';
    this.ocupado = true;
    try {
      const procesarPaso = () =>
        this.prisma.cliente.$transaction(
          async (tx) => {
            const [bloqueo] = await tx.$queryRaw<
              { obtenido: boolean }[]
            >`SELECT pg_try_advisory_xact_lock(173921, 13) AS obtenido`;
            if (!bloqueo.obtenido) return;
            const enviadas = await tx.anclajeResena.findFirst({
              where: {
                firmada: { not: null },
                estado: { in: ['enviado', 'fallido'] },
              },
              orderBy: { creadoEn: 'asc' },
            });
            const registro =
              enviadas ??
              (await tx.anclajeResena.findFirst({
                where: { estado: 'pendiente' },
                orderBy: [{ creadoEn: 'asc' }, { resenaId: 'asc' }],
              }));
            if (!registro) {
              const anteriores = await tx.resena.findMany({
                where: {
                  visitaId: { not: null },
                  retiradaEn: null,
                  anclaje: null,
                },
                select: {
                  id: true,
                  destinoId: true,
                  calificacion: true,
                  comentario: true,
                },
                take: 25,
              });
              await tx.anclajeResena.createMany({
                data: anteriores.map((resena) => ({
                  resenaId: resena.id,
                  huella: huellaResena(resena),
                })),
                skipDuplicates: true,
              });
              return;
            }
            if (registro.estado === 'fallido') return;
            const where = { resenaId: registro.resenaId };
            try {
              await red.comprobarRed();
              if (
                registro.firmada &&
                registro.transaccion &&
                registro.contrato
              ) {
                const hash = registro.transaccion as Hex;
                const recibo = await red.consultar(
                  hash,
                  registro.huella as Hex,
                  registro.contrato as Address,
                );
                if (recibo.estado === 'confirmando') return;
                if (recibo.estado === 'sin-recibo') {
                  await red.propagar(registro.firmada, hash);
                  if (registro.intentos)
                    await tx.anclajeResena.update({
                      where,
                      data: { intentos: 0, error: null },
                    });
                  return;
                }
                await tx.anclajeResena.update({
                  where,
                  data: {
                    estado: recibo.estado,
                    firmada: null,
                    bloque: recibo.bloque,
                    costoWei: recibo.costoWei,
                    confirmadoEn:
                      recibo.estado === 'confirmado' ? new Date() : null,
                    error:
                      recibo.estado === 'fallido'
                        ? 'La transacción terminó sin registrar la huella.'
                        : null,
                  },
                });
                return;
              }
              const firma = await red.firmar(registro.huella as Hex);
              await tx.anclajeResena.update({
                where,
                data: {
                  ...firma,
                  contrato: red.contrato,
                  estado: 'enviado',
                  intentos: 0,
                  error: null,
                },
              });
              return true;
            } catch {
              const intentos = registro.intentos + 1;
              await tx.anclajeResena.update({
                where,
                data: {
                  intentos,
                  estado:
                    intentos >= intentosMaximos ? 'fallido' : registro.estado,
                  error:
                    'La red de prueba o el firmante no pudo procesar el registro.',
                },
              });
            }
          },
          { maxWait: 8000, timeout: 35000 },
        );
      if (await procesarPaso()) await procesarPaso();
      return 'procesado';
    } catch {
      this.logger.warn(
        'No se pudo sincronizar la cola de anclajes de reseñas.',
      );
      return 'error';
    } finally {
      this.ocupado = false;
    }
  }

  async listar(
    estado: string | undefined,
    buscar: string | undefined,
    pagina: number,
  ) {
    const where = filtrosAuditoria(estado, buscar);
    const cliente = this.prisma.cliente.anclajeResena;
    const [total, filas, confirmados, pendientes, costos] = await Promise.all([
      cliente.count({ where }),
      cliente.findMany({
        where,
        orderBy: ordenAuditoria,
        skip: (pagina - 1) * 20,
        take: 20,
        select: seleccionAuditoria,
      }),
      cliente.count({ where: { estado: 'confirmado' } }),
      cliente.count({ where: { estado: { in: ['pendiente', 'enviado'] } } }),
      this.prisma.cliente.$queryRaw<{ promedio: string | null }[]>`
        SELECT round(avg(costo_wei::numeric))::text AS promedio FROM munay.anclajes_resenas WHERE estado = 'confirmado'`,
    ]);
    return {
      total,
      filas,
      confirmados,
      pendientes,
      costoPromedioWei: costos[0]?.promedio,
      contrato: this.red?.contrato ?? null,
    };
  }

  async *exportar(estado: unknown, buscar: unknown) {
    const filtro = filtrosAuditoria(estado, buscar);
    const corte = new Date();
    const cliente = this.prisma.cliente.anclajeResena;
    yield '\uFEFF' +
      filaCsv([
        'ID reseña',
        'Fecha de registro (UTC)',
        'Destino',
        'ID usuario',
        'Calificación',
        'Huella SHA-256',
        'Transacción',
        'Bloque',
        'Estado',
        'Contrato',
        'Costo en wei',
        'Fecha de confirmación (UTC)',
        'Error',
      ]);

    let limite: { creadoEn: Date; resenaId: string } | undefined;
    for (;;) {
      const anteriores: Prisma.AnclajeResenaWhereInput = limite
        ? {
            OR: [
              { creadoEn: { lt: limite.creadoEn } },
              { creadoEn: limite.creadoEn, resenaId: { lt: limite.resenaId } },
            ],
          }
        : {};
      const registros = await cliente.findMany({
        where: { AND: [filtro, { creadoEn: { lte: corte } }, anteriores] },
        orderBy: ordenAuditoria,
        take: 250,
        select: {
          ...seleccionAuditoria,
          contrato: true,
          costoWei: true,
          confirmadoEn: true,
        },
      });
      if (!registros.length) break;
      yield registros
        .map((fila) =>
          filaCsv([
            fila.resenaId,
            fila.creadoEn.toISOString(),
            fila.resena.destino.nombre,
            fila.resena.usuarioId,
            fila.resena.calificacion,
            fila.huella,
            fila.transaccion,
            fila.bloque,
            fila.estado,
            fila.contrato,
            fila.costoWei,
            fila.confirmadoEn?.toISOString() ?? null,
            fila.error,
          ]),
        )
        .join('');
      if (registros.length < 250) break;
      const ultima = registros[registros.length - 1];
      limite = { creadoEn: ultima.creadoEn, resenaId: ultima.resenaId };
    }
  }

  async reintentar(resenaId: string) {
    if (!this.red)
      throw new ConflictException(
        'Configura la conexión a Sepolia para reintentar.',
      );
    const cliente = this.prisma.cliente.anclajeResena;
    const fila = await cliente.findUnique({
      where: { resenaId },
      select: { firmada: true, estado: true },
    });
    if (!fila) throw new NotFoundException('El registro no está disponible.');
    if (fila.estado !== 'fallido')
      throw new ConflictException(
        'El registro ya está en procesamiento o confirmado.',
      );
    await cliente.updateMany({
      where: { resenaId, estado: 'fallido' },
      data: {
        estado: fila.firmada ? 'enviado' : 'pendiente',
        intentos: 0,
        error: null,
      },
    });
  }
}
