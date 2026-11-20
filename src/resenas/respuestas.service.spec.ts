import { describe, expect, it, vi } from 'vitest';
import { RespuestasService } from './respuestas.service.js';
import type { ServicioPrisma } from '../prisma/prisma.service.js';

const id = '07909f01-2bd9-4652-98a8-a47ade18bfdf';
const perfil = { id: 'visitante', rol: 'TURISTA' } as const;

function preparar() {
  const respuestas = {
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue({ id }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const tx = {
    $queryRaw: vi.fn(),
    respuestaResena: respuestas,
    resena: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: 'resena', destino: { administradores: [] } }),
    },
  };
  const servicio = new RespuestasService({
    cliente: {
      ...tx,
      $transaction: <T>(accion: (tx: unknown) => T) => accion(tx),
    },
  } as unknown as ServicioPrisma);
  return { servicio, respuestas, tx };
}

describe('Conversaciones de reseñas', () => {
  it('impide que un encargado responda reseñas ajenas', async () => {
    const { servicio, respuestas } = preparar();
    await expect(
      servicio.publicar(
        'resena',
        { id: 'encargado', rol: 'ADMIN_DESTINO' },
        'Gracias',
        id,
      ),
    ).rejects.toThrow('atractivo asignado');
    expect(respuestas.create).not.toHaveBeenCalled();
  });

  it('identifica como oficial la respuesta del encargado asignado', async () => {
    const { servicio, respuestas, tx } = preparar();
    tx.resena.findFirst.mockResolvedValue({
      id: 'resena',
      destino: { administradores: [{ usuarioId: 'encargado' }] },
    });
    await servicio.publicar(
      'resena',
      { id: 'encargado', rol: 'ADMIN_DESTINO' },
      'Gracias por tu visita.',
      id,
    );
    expect(respuestas.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          oficial: true,
          usuarioId: 'encargado',
        }),
      }),
    );
  });

  it('una respuesta de visitante nunca recibe la insignia oficial', async () => {
    const { servicio, respuestas } = preparar();
    await servicio.publicar('resena', perfil, 'Gracias', id);
    expect(respuestas.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ oficial: false }),
      }),
    );
  });

  it('rechaza respuestas a reseñas retiradas', async () => {
    const { servicio, respuestas, tx } = preparar();
    tx.resena.findFirst.mockResolvedValueOnce(null);
    await expect(
      servicio.publicar('resena', perfil, 'Muy útil, gracias.', id),
    ).rejects.toThrow('ya no está disponible');
    expect(respuestas.create).not.toHaveBeenCalled();
  });

  it('reconoce el mismo envío sin crear otra respuesta', async () => {
    const { servicio, respuestas } = preparar();
    respuestas.findUnique.mockResolvedValue({
      id,
      usuarioId: perfil.id,
      resenaId: 'resena',
      comentario: 'Gracias',
      retiradaEn: null,
    });
    await expect(
      servicio.publicar('resena', perfil, 'Gracias', id),
    ).resolves.toEqual({ id });
    expect(respuestas.create).not.toHaveBeenCalled();
  });

  it('limita respuestas sucesivas de una misma cuenta', async () => {
    const { servicio, respuestas } = preparar();
    respuestas.count.mockResolvedValue(5);
    await expect(
      servicio.publicar('resena', perfil, 'Gracias', id),
    ).rejects.toThrow('Espera un minuto');
    expect(respuestas.create).not.toHaveBeenCalled();
  });

  it('restringe la retirada al autor de la respuesta', async () => {
    const { servicio, respuestas } = preparar();
    await servicio.retirar(id, perfil);
    expect(respuestas.updateMany).toHaveBeenCalledWith({
      where: { id, usuarioId: perfil.id, retiradaEn: null },
      data: { retiradaEn: expect.any(Date) },
    });
  });

  it('solo devuelve respuestas visibles y oculta el identificador del usuario', async () => {
    const { servicio, respuestas } = preparar();
    respuestas.findMany.mockResolvedValue([
      {
        id,
        usuarioId: perfil.id,
        comentario: 'Gracias',
        creadaEn: new Date(),
        usuario: { nombreCompleto: 'Visitante' },
      },
    ]);
    const resultado = await servicio.listar('resena', 1, perfil);
    expect(resultado.respuestas[0]).toMatchObject({
      propia: true,
      comentario: 'Gracias',
    });
    expect(resultado.respuestas[0]).not.toHaveProperty('usuarioId');
    expect(respuestas.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          resenaId: 'resena',
          retiradaEn: null,
          resena: {
            retiradaEn: null,
            destino: { estadoEditorial: 'publicada' },
          },
        },
      }),
    );
  });
});
