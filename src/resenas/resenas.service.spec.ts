import { describe, expect, it, vi } from 'vitest';
import type { DestinosService } from '../destinos/destinos.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { ServicioPrisma } from '../prisma/prisma.service.js';
import type { PuntosService } from '../puntos/puntos.service.js';
import { ResenasService } from './resenas.service.js';

const id = '07909f01-2bd9-4652-98a8-a47ade18bfdf';
const perfil = { id: 'turista', rol: 'TURISTA' } as const;
const comentario = 'El recorrido y los guías fueron excelentes.';

function prepararServicio() {
  const tx = {
    $queryRaw: vi.fn(),
    destino: {
      findUnique: vi.fn().mockResolvedValue({ id: 'destino' }),
      update: vi.fn(),
    },
    visitaVerificada: {
      findUnique: vi.fn().mockResolvedValue({ id: 'visita', resena: null }),
    },
    resena: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id }),
      aggregate: vi.fn().mockResolvedValue({ _avg: { calificacion: 5 } }),
    },
  };
  const cliente = {
    $queryRaw: vi.fn().mockResolvedValue([{ destinoId: 'destino' }]),
    destino: { findUnique: vi.fn().mockResolvedValue({ id: 'destino' }) },
    $transaction: <T>(accion: (transaccion: unknown) => Promise<T>) =>
      accion(tx),
    resena: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  const puntos = { acreditar: vi.fn().mockResolvedValue(undefined) };
  const destinos = { limpiarCache: vi.fn() };
  const servicio = new ResenasService(
    { cliente } as unknown as ServicioPrisma,
    puntos as unknown as PuntosService,
    destinos as unknown as DestinosService,
  );
  return { servicio, tx, destinos, cliente };
}

describe('Enlace público de una reseña', () => {
  it('solo consulta reseñas visibles de destinos publicados', async () => {
    const { servicio, cliente } = prepararServicio();
    await expect(servicio.obtener(id)).rejects.toThrow(
      'Esta reseña ya no está disponible.',
    );
    expect(cliente.resena.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id,
          retiradaEn: null,
          destino: { estadoEditorial: 'publicada' },
        },
      }),
    );
  });
});

describe('Publicación de una reseña verificada', () => {
  it('deja la reseña preparada para sentimiento, riesgo y anclaje', async () => {
    const { servicio, tx, destinos } = prepararServicio();
    await expect(
      servicio.publicar('tucume', perfil, 5, comentario, id),
    ).resolves.toEqual({ id });
    const creada = tx.resena.create.mock.calls[0][0] as Prisma.ResenaCreateArgs;
    expect(creada.data).toMatchObject({
      id,
      visitaId: 'visita',
      sentimiento: expect.any(String),
      riesgo: expect.any(Number),
      anclaje: {
        create: { huella: expect.stringMatching(/^(?:0x)?[a-f0-9]{64}$/) },
      },
    });
    expect(destinos.limpiarCache).toHaveBeenCalled();
  });

  it('reconoce el envío guardado y bloquea un segundo contenido', async () => {
    const { servicio, tx } = prepararServicio();
    tx.visitaVerificada.findUnique.mockResolvedValue({
      id: 'visita',
      resena: { id, calificacion: 5, comentario, retiradaEn: null },
    });
    await expect(
      servicio.publicar('tucume', perfil, 5, comentario, id),
    ).resolves.toEqual({ id });
    await expect(
      servicio.publicar('tucume', perfil, 4, comentario, id),
    ).rejects.toThrow('Ya publicaste');
    expect(tx.resena.create).not.toHaveBeenCalled();
  });
});

describe('Fotos de una reseña', () => {
  it('requiere autorización para publicar una foto', async () => {
    const { servicio, tx } = prepararServicio();
    await expect(
      servicio.publicar(
        'tucume',
        perfil,
        5,
        comentario,
        id,
        'foto.jpg',
        false,
        false,
      ),
    ).rejects.toThrow('Autoriza la publicación');
    expect(tx.resena.create).not.toHaveBeenCalled();
  });

  it('exige una foto para solicitar el bono de selfie', async () => {
    const { servicio, tx } = prepararServicio();
    await expect(
      servicio.publicar('tucume', perfil, 5, comentario, id, undefined, true),
    ).rejects.toThrow('Adjunta tu selfie');
    expect(tx.resena.create).not.toHaveBeenCalled();
  });

  it('rechaza una imagen de otra cuenta antes de consultar storage', async () => {
    const { servicio, tx } = prepararServicio();
    await expect(
      servicio.publicar(
        'tucume',
        perfil,
        5,
        comentario,
        id,
        'otra-cuenta/foto.jpg',
        true,
        true,
      ),
    ).rejects.toThrow('La foto no pertenece');
    expect(tx.resena.create).not.toHaveBeenCalled();
  });
});

describe('Publicación de foto y bono de selfie', () => {
  it('guarda la foto propia y la declaración para acreditar el bono una sola vez', async () => {
    const { servicio, tx, cliente } = prepararServicio();
    const archivo = perfil.id + '/' + id + '/' + id + '.jpg';
    const urlAnterior = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = 'https://prueba.supabase.co';
    try {
      await servicio.publicar(
        'tucume',
        perfil,
        5,
        comentario,
        id,
        archivo,
        true,
        true,
      );
      expect(cliente.$queryRaw).toHaveBeenCalledOnce();
      expect(tx.resena.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fotoUrl:
              'https://prueba.supabase.co/storage/v1/object/public/resenas/' +
              archivo,
            selfieDeclarada: true,
            visitaId: 'visita',
          }),
        }),
      );
    } finally {
      if (urlAnterior === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = urlAnterior;
    }
  });

  it('rechaza una foto que no existe en el storage autorizado', async () => {
    const { servicio, tx, cliente } = prepararServicio();
    cliente.$queryRaw.mockResolvedValue([]);
    const archivo = perfil.id + '/' + id + '/' + id + '.jpg';
    await expect(
      servicio.publicar(
        'tucume',
        perfil,
        5,
        comentario,
        id,
        archivo,
        true,
        true,
      ),
    ).rejects.toThrow('Sube una foto');
    expect(tx.resena.create).not.toHaveBeenCalled();
  });

  it('rechaza fotos asociadas a un destino diferente', async () => {
    const { servicio, tx, cliente } = prepararServicio();
    cliente.$queryRaw.mockResolvedValue([{ destinoId: 'ajeno' }]);
    const archivo = perfil.id + '/' + id + '/' + id + '.jpg';
    await expect(
      servicio.publicar(
        'tucume',
        perfil,
        5,
        comentario,
        id,
        archivo,
        true,
        true,
      ),
    ).rejects.toThrow('La foto no corresponde');
    expect(tx.resena.create).not.toHaveBeenCalled();
  });
});
