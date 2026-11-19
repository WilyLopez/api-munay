import { describe, expect, it, vi } from 'vitest';
import type { ServicioPrisma } from '../prisma/prisma.service.js';
import type { PuntosService } from '../puntos/puntos.service.js';
import type { DestinosService } from '../destinos/destinos.service.js';
import { ResenasService } from './resenas.service.js';

function fila(id: string, calificacion = 5, verificada = true) {
  return {
    id,
    comentario: 'Experiencia de prueba',
    calificacion,
    creadaEn: new Date('2026-11-19T15:00:00Z'),
    visitaId: verificada ? 'visita' : null,
    visita: verificada
      ? { verificadaEn: new Date('2026-11-19T14:00:00Z') }
      : null,
    usuario: { nombreCompleto: 'Visitante' },
    destino: { nombre: 'Museo', slug: 'museo', imagenUrl: null },
    anclaje: null,
    fotoUrl: null,
    _count: { votos: 0, respuestas: 0 },
    votos: [],
  };
}
function preparar() {
  const votos = new Set<string>();
  const resena = {
    findMany: vi
      .fn()
      .mockResolvedValue([fila('primera'), fila('segunda', 3, false)]),
    groupBy: vi.fn().mockResolvedValue([
      { calificacion: 5, _count: { _all: 1 } },
      { calificacion: 3, _count: { _all: 1 } },
    ]),
    count: vi.fn().mockResolvedValue(1),
    findFirst: vi.fn().mockResolvedValue({ id: 'resena' }),
  };
  const votoResena = {
    createMany: vi.fn(
      ({
        data,
        skipDuplicates,
      }: {
        data: { resenaId: string; usuarioId: string };
        skipDuplicates: boolean;
      }) => {
        const clave = `${data.resenaId}:${data.usuarioId}`;
        if (!skipDuplicates && votos.has(clave))
          throw new Error('Voto duplicado');
        votos.add(clave);
        return Promise.resolve({ count: 1 });
      },
    ),
    deleteMany: vi.fn(
      ({ where }: { where: { resenaId: string; usuarioId: string } }) => {
        votos.delete(`${where.resenaId}:${where.usuarioId}`);
        return Promise.resolve({ count: 1 });
      },
    ),
  };
  const cliente = {
    resena,
    votoResena,
    destino: {
      findUnique: vi.fn().mockResolvedValue({ id: 'destino', nombre: 'Museo' }),
      findMany: vi.fn().mockResolvedValue([{ slug: 'museo', nombre: 'Museo' }]),
    },
    visitaVerificada: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  const servicio = new ResenasService(
    { cliente } as unknown as ServicioPrisma,
    {} as PuntosService,
    {} as DestinosService,
  );
  return { servicio, cliente, votos };
}

describe('Consulta de opiniones', () => {
  it('presenta autor, calificación y visita verificada sin exponer registros retirados', async () => {
    const { servicio, cliente } = preparar();
    const respuesta = await servicio.listar(undefined, 'fecha', 1);
    expect(respuesta.resenas[0]).toMatchObject({
      usuario: { nombreCompleto: 'Visitante' },
      calificacion: 5,
      verificada: true,
      fechaVisita: expect.any(Date),
    });
    expect(respuesta.resenas[1]).toMatchObject({
      verificada: false,
      fechaVisita: null,
    });
    expect(cliente.resena.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { retiradaEn: null, destino: { estadoEditorial: 'publicada' } },
      }),
    );
  });
  it('calcula el promedio ponderado, el total y la distribución con el mismo filtro', async () => {
    const { servicio, cliente } = preparar();
    cliente.resena.groupBy.mockResolvedValue([
      { calificacion: 5, _count: { _all: 2 } },
      { calificacion: 3, _count: { _all: 1 } },
    ]);
    cliente.resena.count.mockResolvedValue(2);
    const respuesta = await servicio.listar('museo', 'fecha', 1);
    expect(respuesta.promedio).toBeCloseTo(13 / 3);
    expect(respuesta.total).toBe(3);
    expect(respuesta.verificadas).toBe(2);
    expect(respuesta.distribucion).toEqual([
      { calificacion: 5, total: 2 },
      { calificacion: 3, total: 1 },
    ]);
    const filtro = {
      retiradaEn: null,
      destino: { estadoEditorial: 'publicada' },
      destinoId: 'destino',
    };
    expect(cliente.resena.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: filtro }),
    );
    expect(cliente.resena.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: filtro }),
    );
    expect(cliente.resena.count).toHaveBeenCalledWith({
      where: { ...filtro, visitaId: { not: null } },
    });
  });
  it('ordena por fecha con desempate estable y por calificación cuando se solicita', async () => {
    const { servicio, cliente } = preparar();
    await servicio.listar(undefined, 'fecha', 1);
    expect(cliente.resena.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        orderBy: [{ creadaEn: 'desc' }, { id: 'desc' }],
      }),
    );
    await servicio.listar(undefined, 'calificacion', 1);
    expect(cliente.resena.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        orderBy: [
          { calificacion: 'desc' },
          { creadaEn: 'desc' },
          { id: 'desc' },
        ],
      }),
    );
  });
  it('rechaza un atractivo inexistente sin consultar sus reseñas', async () => {
    const { servicio, cliente } = preparar();
    cliente.destino.findUnique.mockResolvedValue(null);
    await expect(servicio.listar('inexistente', 'fecha', 1)).rejects.toThrow(
      'no está disponible',
    );
    expect(cliente.resena.findMany).not.toHaveBeenCalled();
  });
  it('informa estado vacío sin fabricar un promedio', async () => {
    const { servicio, cliente } = preparar();
    cliente.resena.findMany.mockResolvedValue([]);
    cliente.resena.groupBy.mockResolvedValue([]);
    cliente.resena.count.mockResolvedValue(0);
    const respuesta = await servicio.listar(undefined, 'fecha', 1);
    expect(respuesta).toMatchObject({
      total: 0,
      promedio: null,
      verificadas: 0,
      distribucion: [],
      resenas: [],
    });
  });
  it('pagina sin alterar el total de valoraciones del destino', async () => {
    const { servicio, cliente } = preparar();
    cliente.resena.findMany.mockResolvedValue(
      Array.from({ length: 21 }, (_, i) => fila(String(i))),
    );
    const respuesta = await servicio.listar('museo', 'fecha', 2);
    expect(respuesta.resenas).toHaveLength(20);
    expect(respuesta.hayMas).toBe(true);
    expect(cliente.resena.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 21 }),
    );
  });
});

describe('Votos útiles', () => {
  it('no duplica el voto y permite retirar solo el de su propietario', async () => {
    const { servicio, votos } = preparar();
    await servicio.votar('resena', 'primero', true);
    await servicio.votar('resena', 'primero', true);
    await servicio.votar('resena', 'segundo', true);
    expect(votos.size).toBe(2);
    await servicio.votar('resena', 'primero', false);
    await servicio.votar('resena', 'primero', false);
    expect([...votos]).toEqual(['resena:segundo']);
  });
  it('no permite votar una reseña retirada o de un destino no publicado', async () => {
    const { servicio, cliente } = preparar();
    cliente.resena.findFirst.mockResolvedValue(null);
    await expect(servicio.votar('retirada', 'usuario', true)).rejects.toThrow(
      'no está disponible',
    );
    expect(cliente.votoResena.createMany).not.toHaveBeenCalled();
    expect(cliente.resena.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'retirada',
        retiradaEn: null,
        destino: { estadoEditorial: 'publicada' },
      },
      select: { id: true },
    });
  });
});
