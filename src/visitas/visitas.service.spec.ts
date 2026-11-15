import { describe, expect, it, vi } from 'vitest';
import type { ServicioPrisma } from '../prisma/prisma.service.js';
import { VisitasService } from './visitas.service.js';

const destino = { id: 'destino-id', nombre: 'Túcume', slug: 'tucume' };
const encargado = { id: 'encargado-id', rol: 'ADMIN_DESTINO' } as const;

function prepararServicio() {
  const creadoEn = new Date('2026-11-15T15:00:00Z');
  const venceEn = new Date('2026-11-15T15:01:00Z');
  const vigente = { id: 'qr-vigente', creadoEn, venceEn };
  const nuevo = { id: 'qr-nuevo', creadoEn, venceEn };
  const codigos = {
    findFirst: vi.fn().mockResolvedValue(vigente),
    update: vi.fn().mockResolvedValue(vigente),
    create: vi.fn().mockResolvedValue(nuevo),
  };
  const cliente = {
    destino: {
      findFirst: vi.fn().mockResolvedValue(destino),
      count: vi.fn().mockResolvedValue(1),
    },
    visitaVerificada: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    $transaction: <T>(accion: (tx: unknown) => Promise<T>) =>
      accion({ $queryRaw: vi.fn(), codigoVisita: codigos }),
  };
  const servicio = new VisitasService({ cliente } as unknown as ServicioPrisma);
  return { servicio, codigos, vigente, nuevo };
}

describe('Renovación del QR del destino', () => {
  it('invalida el QR que se muestra y emite otro', async () => {
    const { servicio, codigos, vigente, nuevo } = prepararServicio();
    const resultado = await servicio.sincronizar(
      encargado,
      destino.slug,
      true,
      vigente.id,
    );
    expect(codigos.update).toHaveBeenCalledWith({
      where: { id: vigente.id },
      data: { anuladoEn: expect.any(Date) },
    });
    expect(resultado.codigo.id).toBe(nuevo.id);
  });

  it('conserva el QR vigente cuando otra pantalla ya hizo la renovación', async () => {
    const { servicio, codigos, vigente } = prepararServicio();
    const resultado = await servicio.sincronizar(
      encargado,
      destino.slug,
      true,
      'qr-anterior',
    );
    expect(resultado.codigo.id).toBe(vigente.id);
    expect(codigos.update).not.toHaveBeenCalled();
    expect(codigos.create).not.toHaveBeenCalled();
  });
});

describe('Período de las estadísticas del atractivo', () => {
  it('agrupa tres meses de Lima y aplica el mismo intervalo a las reseñas', async () => {
    vi.useFakeTimers();
    try {
      const ahora = new Date('2026-11-01T04:50:00Z');
      vi.setSystemTime(ahora);
      const desde = new Date('2026-08-01T05:00:00Z');
      const filtro = {
        destinoId: destino.id,
        retiradaEn: null,
        creadaEn: { gte: desde, lte: ahora },
      };
      const cliente = {
        destino: { findFirst: vi.fn().mockResolvedValue(destino) },
        $queryRaw: vi.fn().mockResolvedValue([{ mes: '2026-10', total: 3 }]),
        resena: {
          aggregate: vi
            .fn()
            .mockResolvedValue({
              _avg: { calificacion: 4.5 },
              _count: { _all: 2 },
            }),
          findMany: vi.fn().mockResolvedValue([]),
        },
      };
      const servicio = new VisitasService({
        cliente,
      } as unknown as ServicioPrisma);
      const resultado = await servicio.estadisticas(encargado, destino.slug, 3);
      expect(cliente.destino.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            slug: destino.slug,
            administradores: { some: { usuarioId: encargado.id } },
          },
        }),
      );
      expect(cliente.$queryRaw.mock.calls[0].slice(1)).toEqual([
        destino.id,
        desde,
        ahora,
      ]);
      expect(cliente.resena.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: filtro }),
      );
      expect(cliente.resena.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: filtro }),
      );
      expect(resultado).toMatchObject({
        tendencia: [
          { mes: '2026-08', total: 0 },
          { mes: '2026-09', total: 0 },
          { mes: '2026-10', total: 3 },
        ],
        totalVisitas: 3,
        totalResenas: 2,
        promedio: 4.5,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
