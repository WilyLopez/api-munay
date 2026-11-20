import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ServicioPrisma } from '../prisma/prisma.service.js';
import { VisitasService } from './visitas.service.js';

function preparar(encontrado: boolean) {
  const cliente = {
    destino: {
      findFirst: vi
        .fn()
        .mockResolvedValue(encontrado ? { id: 'destino-id' } : null),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    visitaVerificada: { count: vi.fn().mockResolvedValue(0) },
    resena: {
      aggregate: vi
        .fn()
        .mockResolvedValue({
          _count: { _all: 0 },
          _avg: { calificacion: null },
        }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  return {
    cliente,
    servicio: new VisitasService({ cliente } as unknown as ServicioPrisma),
  };
}

describe('Acceso a estadísticas', () => {
  it('rechaza al turista antes de consultar información del destino', async () => {
    const { servicio, cliente } = preparar(true);
    await expect(
      servicio.estadisticas({ id: 'turista', rol: 'TURISTA' }, 'museo', 3),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(cliente.destino.findFirst).not.toHaveBeenCalled();
    expect(cliente.$queryRaw).not.toHaveBeenCalled();
  });

  it('no consulta indicadores de un destino ajeno al encargado', async () => {
    const { servicio, cliente } = preparar(false);
    await expect(
      servicio.estadisticas({ id: 'admin', rol: 'ADMIN_DESTINO' }, 'ajeno', 3),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(cliente.destino.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          slug: 'ajeno',
          administradores: { some: { usuarioId: 'admin' } },
        },
      }),
    );
    expect(cliente.$queryRaw).not.toHaveBeenCalled();
    expect(cliente.resena.aggregate).not.toHaveBeenCalled();
  });

  it('permite al SuperAdmin consultar un destino sin asignación y devuelve un período vacío coherente', async () => {
    const { servicio, cliente } = preparar(true);
    const resultado = await servicio.estadisticas(
      { id: 'super', rol: 'SUPER_ADMIN' },
      'museo',
      3,
    );
    expect(cliente.destino.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'museo' } }),
    );
    expect(resultado).toMatchObject({
      totalVisitas: 0,
      totalResenas: 0,
      promedio: null,
      recientes: [],
    });
    expect(resultado.tendencia).toHaveLength(3);
    expect(resultado.tendencia.every(({ total }) => total === 0)).toBe(true);
    expect(cliente.resena.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 5,
        orderBy: [{ creadaEn: 'desc' }, { id: 'desc' }],
      }),
    );
  });
});
