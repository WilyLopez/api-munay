import { describe, expect, it, vi } from 'vitest';
import {
  AnalisisRiesgoService,
  proximoIntentoRiesgo,
} from './analisis-riesgo.service.js';
import type { ServicioPrisma } from '../prisma/prisma.service.js';
import type { PuntosService } from '../puntos/puntos.service.js';
import casos from './fixtures-predicciones-riesgo.json' with { type: 'json' };
const trabajo = {
  resenaId: '11111111-1111-4111-8111-111111111111',
  intentos: 1,
  token: '22222222-2222-4222-8222-222222222222',
};
const perfil = { id: 'superadmin', rol: 'SUPER_ADMIN' } as const;
function preparar(sospechosa = false) {
  const caso = casos.find((c) =>
    sospechosa ? c.puntajeEsperado > 70 : c.puntajeEsperado <= 70,
  )!;
  const puntos = { acreditar: vi.fn().mockResolvedValue(undefined) };
  const tx = {
    $queryRaw: vi.fn(),
    analisisRiesgo: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ ...trabajo, estado: 'procesando' }),
      update: vi.fn(),
    },
    resena: {
      findUnique: vi
        .fn()
        .mockResolvedValue({
          retiradaEn: null,
          visitaId: 'visita',
          reportes: [],
        }),
      update: vi.fn(),
    },
    reporteResena: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
  };
  const cliente = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValueOnce([trabajo]).mockResolvedValue([]),
    $transaction: <T>(accion: (transaccion: unknown) => Promise<T>) =>
      accion(tx),
    resena: {
      findUnique: vi
        .fn()
        .mockResolvedValue({
          usuarioId: 'usuario',
          comentario: caso.texto,
          creadaEn: new Date(caso.ahora),
          retiradaEn: null,
        }),
      findMany: vi
        .fn()
        .mockResolvedValue(
          caso.anteriores.map((r) => ({
            ...r,
            creadaEn: new Date(r.creadaEn),
          })),
        ),
    },
    analisisRiesgo: {
      findUnique: vi.fn().mockResolvedValue({ estado: 'fallido' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const servicio = new AnalisisRiesgoService(
    { cliente } as unknown as ServicioPrisma,
    puntos as unknown as PuntosService,
  );
  return { servicio, cliente, tx, puntos };
}
describe('Cola durable de análisis de riesgo', () => {
  it('completa una reseña sin alerta y habilita sus puntos sin cambiar visibilidad', async () => {
    const { servicio, tx, puntos } = preparar();
    expect(await servicio.analizar(trabajo)).toBe(true);
    expect(tx.resena.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ puntosPendientes: true }),
      }),
    );
    expect(tx.resena.update.mock.calls[0][0].data).not.toHaveProperty(
      'retiradaEn',
    );
    expect(tx.analisisRiesgo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: 'completado',
          token: null,
          error: null,
        }),
      }),
    );
    expect(tx.reporteResena.create).not.toHaveBeenCalled();
    expect(puntos.acreditar).toHaveBeenCalledWith(trabajo.resenaId);
  });
  it('envía una alerta de alto riesgo a revisión y mantiene sus puntos pendientes', async () => {
    const { servicio, tx } = preparar(true);
    await servicio.analizar(trabajo);
    expect(tx.resena.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ puntosPendientes: false }),
      }),
    );
    expect(tx.reporteResena.create).toHaveBeenCalledOnce();
    expect(
      tx.reporteResena.create.mock.calls[0][0].data.riesgo,
    ).toBeGreaterThan(70);
  });
  it('no sobrescribe el resultado si otro trabajador reclamó el trabajo', async () => {
    const { servicio, tx, puntos } = preparar();
    tx.analisisRiesgo.findUnique.mockResolvedValue({
      ...trabajo,
      estado: 'procesando',
      token: 'otro',
    });
    expect(await servicio.analizar(trabajo)).toBe(false);
    expect(tx.resena.update).not.toHaveBeenCalled();
    expect(tx.analisisRiesgo.update).not.toHaveBeenCalled();
    expect(puntos.acreditar).not.toHaveBeenCalled();
  });
  it('respeta una decisión humana de mantener la reseña aunque el índice sea alto', async () => {
    const { servicio, tx } = preparar(true);
    tx.resena.findUnique.mockResolvedValue({
      retiradaEn: null,
      visitaId: 'visita',
      reportes: [{ decision: 'mantener' }],
    });
    await servicio.analizar(trabajo);
    expect(tx.reporteResena.create).not.toHaveBeenCalled();
    expect(tx.resena.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ puntosPendientes: true }),
      }),
    );
  });
  it('no recupera ni recompensa una reseña que fue retirada durante el análisis', async () => {
    const { servicio, tx } = preparar(true);
    tx.resena.findUnique.mockResolvedValue({
      retiradaEn: new Date(),
      visitaId: 'visita',
      reportes: [{ decision: 'retirar' }],
    });
    await servicio.analizar(trabajo);
    expect(tx.resena.update).toHaveBeenCalledWith({
      where: { id: trabajo.resenaId },
      data: { puntosPendientes: false },
    });
    expect(tx.reporteResena.create).not.toHaveBeenCalled();
  });
  it('conserva la reseña y programa reintento cuando falla el modelo', async () => {
    const { servicio, cliente, tx, puntos } = preparar();
    vi.stubEnv('RIESGO_ML_HABILITADO', 'false');
    try {
      expect(await servicio.procesar()).toEqual({ procesados: 0, fallidos: 1 });
      expect(cliente.analisisRiesgo.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            resenaId: trabajo.resenaId,
            estado: 'procesando',
            token: trabajo.token,
          },
          data: expect.objectContaining({
            estado: 'fallido',
            proximoIntentoEn: expect.any(Date),
            token: null,
          }),
        }),
      );
      expect(tx.resena.update).not.toHaveBeenCalled();
      expect(puntos.acreditar).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('reserva las operaciones de reintento y consulta al SuperAdmin', async () => {
    const { servicio, cliente } = preparar();
    await expect(
      servicio.reintentar({ id: 'turista', rol: 'TURISTA' }, trabajo.resenaId),
    ).rejects.toThrow();
    await expect(
      servicio.listar({ id: 'admin', rol: 'ADMIN_DESTINO' }, 1),
    ).rejects.toThrow();
    expect(cliente.analisisRiesgo.findUnique).not.toHaveBeenCalled();
  });
  it('no vuelve a encolar análisis completados ni procesamientos activos', async () => {
    const { servicio, cliente } = preparar();
    cliente.analisisRiesgo.updateMany.mockResolvedValue({ count: 0 });
    await expect(servicio.reintentar(perfil, trabajo.resenaId)).rejects.toThrow(
      'terminó o está siendo procesado',
    );
  });
  it('aplica espera creciente entre reintentos', () => {
    const ahora = new Date('2026-11-20T17:00:00Z');
    expect(proximoIntentoRiesgo(1, ahora).getTime() - ahora.getTime()).toBe(
      30000,
    );
    expect(proximoIntentoRiesgo(3, ahora).getTime() - ahora.getTime()).toBe(
      120000,
    );
  });
});
