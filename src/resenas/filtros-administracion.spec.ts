import { describe, expect, it, vi } from 'vitest';
import { ResenasService } from './resenas.service.js';
import type { ServicioPrisma } from '../prisma/prisma.service.js';
import type { PuntosService } from '../puntos/puntos.service.js';
import type { DestinosService } from '../destinos/destinos.service.js';

function preparar() {
  const cliente = {
    destino: {
      findUnique: vi.fn().mockResolvedValue({ id: 'lugar', nombre: 'Museo' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    resena: {
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  };
  const servicio = new ResenasService(
    { cliente } as unknown as ServicioPrisma,
    {} as PuntosService,
    {} as DestinosService,
  );
  return { servicio, cliente };
}
const encargado = { id: 'encargado', rol: 'ADMIN_DESTINO' } as const;

describe('Filtros de reseñas del encargado', () => {
  it('limita el listado y los agregados al atractivo asignado, usando las mismas fechas y filtros', async () => {
    const { servicio, cliente } = preparar();
    await servicio.listar('museo', 'menor', 2, encargado, {
      administracion: '1',
      estrellas: '2',
      desde: '2026-11-01',
      hasta: '2026-11-19',
      foto: '1',
      respuesta: 'pendiente',
    });
    const alcance = { administradores: { some: { usuarioId: encargado.id } } };
    expect(cliente.destino.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'museo', AND: alcance } }),
    );
    const consulta = cliente.resena.findMany.mock.calls[0][0];
    expect(consulta).toMatchObject({
      skip: 20,
      take: 21,
      where: {
        destino: alcance,
        destinoId: 'lugar',
        calificacion: 2,
        fotoUrl: { not: null },
        creadaEn: {
          gte: new Date('2026-11-01T05:00:00Z'),
          lte: new Date('2026-11-20T04:59:59.999Z'),
        },
        respuestas: { none: { retiradaEn: null, oficial: true } },
      },
      orderBy: [{ calificacion: 'asc' }, { creadaEn: 'desc' }, { id: 'desc' }],
    });
    expect(cliente.resena.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: consulta.where }),
    );
  });
  it('deniega el modo administrativo a visitantes y anónimos', async () => {
    const { servicio, cliente } = preparar();
    await expect(
      servicio.listar('museo', undefined, 1, undefined, {
        administracion: '1',
      }),
    ).rejects.toThrow('autorizado');
    await expect(
      servicio.listar(
        'museo',
        undefined,
        1,
        { id: 'turista', rol: 'TURISTA' },
        { administracion: '1' },
      ),
    ).rejects.toThrow('autorizado');
    expect(cliente.resena.findMany).not.toHaveBeenCalled();
  });
  it.each([
    { desde: '2026-02-30' },
    { desde: '2026-15-01' },
    { desde: 'ayer' },
    { desde: '2026-11-19', hasta: '2026-11-01' },
    { estrellas: '6' },
  ])(
    'rechaza filtros inválidos antes de consultar reseñas: %j',
    async (filtros) => {
      const { servicio, cliente } = preparar();
      await expect(
        servicio.listar('museo', undefined, 1, encargado, {
          ...filtros,
          administracion: '1',
        }),
      ).rejects.toThrow();
      expect(cliente.resena.findMany).not.toHaveBeenCalled();
    },
  );
  it('no devuelve datos si el atractivo no está autorizado', async () => {
    const { servicio, cliente } = preparar();
    cliente.destino.findUnique.mockResolvedValueOnce(null);
    await expect(
      servicio.listar('ajeno', undefined, 1, encargado, {
        administracion: '1',
      }),
    ).rejects.toThrow('no está disponible');
    expect(cliente.resena.findMany).not.toHaveBeenCalled();
  });
});
