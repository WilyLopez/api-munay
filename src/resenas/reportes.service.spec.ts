import { describe, expect, it, vi } from 'vitest';
import { ReportesService } from './reportes.service.js';
import type { ServicioPrisma } from '../prisma/prisma.service.js';
const perfil = { id: 'operador', rol: 'SUPER_ADMIN' } as const;
function preparar() {
  const tx = {
    $queryRaw: vi.fn(),
    reporteResena: {
      findUnique: vi
        .fn()
        .mockResolvedValue({
          riesgo: 85,
          resenaId: 'resena',
          resena: { destinoId: 'destino' },
        }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    resena: { updateMany: vi.fn() },
  };
  const cliente = {
    reporteResena: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    destino: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: async <T>(fn: (value: unknown) => Promise<T>) => fn(tx),
  };
  return {
    tx,
    cliente,
    servicio: new ReportesService({ cliente } as unknown as ServicioPrisma),
  };
}
describe('Moderación US-15', () => {
  it('rechaza consultas y decisiones de visitantes y encargados', async () => {
    const { servicio, cliente } = preparar();
    for (const rol of ['USUARIO', 'ADMIN'] as const) {
      await expect(
        servicio.listar({ ...perfil, rol }, false, 1),
      ).rejects.toThrow();
      await expect(
        servicio.revisar('reporte', { ...perfil, rol }, 'mantener', ''),
      ).rejects.toThrow();
    }
    expect(cliente.reporteResena.findMany).not.toHaveBeenCalled();
  });
  it('combina destino y nivel, ordena por riesgo y fecha y entrega la hora del resumen', async () => {
    const { servicio, cliente } = preparar();
    const resultado = await servicio.listar(perfil, false, 2, {
      destino: 'museo',
      nivel: 'alto',
      origen: 'automatico',
    });
    expect(cliente.reporteResena.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          revisadoEn: null,
          resena: { destino: { slug: 'museo' } },
          riesgo: { gt: 70, lt: 90 },
        },
        skip: 20,
        take: 21,
        orderBy: [
          { riesgo: { sort: 'desc', nulls: 'last' } },
          { creadoEn: 'desc' },
          { id: 'desc' },
        ],
      }),
    );
    expect(Number.isFinite(Date.parse(resultado.actualizadoEn))).toBe(true);
  });
  it('mantener una alerta habilita puntos únicamente para visitas verificadas y reseñas visibles', async () => {
    const { servicio, tx } = preparar();
    await servicio.revisar('reporte', perfil, 'mantener', '');
    expect(tx.resena.updateMany).toHaveBeenCalledWith({
      where: { id: 'resena', retiradaEn: null, visitaId: { not: null } },
      data: { puntosPendientes: true },
    });
  });
  it('un reintento con la misma decisión no repite el efecto y una decisión contradictoria se rechaza', async () => {
    const { servicio, tx } = preparar();
    tx.reporteResena.updateMany.mockResolvedValue({ count: 0 });
    tx.reporteResena.findUnique
      .mockResolvedValueOnce({
        riesgo: 85,
        resenaId: 'resena',
        resena: { destinoId: 'destino' },
      })
      .mockResolvedValueOnce({ decision: 'mantener' });
    await servicio.revisar('reporte', perfil, 'mantener', '');
    expect(tx.resena.updateMany).not.toHaveBeenCalled();
    tx.reporteResena.findUnique
      .mockResolvedValueOnce({
        riesgo: 85,
        resenaId: 'resena',
        resena: { destinoId: 'destino' },
      })
      .mockResolvedValueOnce({ decision: 'retirar' });
    await expect(
      servicio.revisar('reporte', perfil, 'mantener', ''),
    ).rejects.toThrow('decisión');
  });
  it('requiere motivo antes de retirar y no inicia una transacción inválida', async () => {
    const { servicio, tx } = preparar();
    await expect(
      servicio.revisar('reporte', perfil, 'retirar', ''),
    ).rejects.toThrow('motivo');
    expect(tx.reporteResena.updateMany).not.toHaveBeenCalled();
  });
});
