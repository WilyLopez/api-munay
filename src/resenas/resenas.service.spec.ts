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
    visitaVerificada: tx.visitaVerificada,
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

  it.each([undefined, null, 0, 6, 1.5, '5', Number.NaN])(
    'rechaza una calificación inválida sin guardar la reseña: %s',
    async (nota) => {
      const { servicio, tx } = prepararServicio();
      await expect(
        servicio.publicar('tucume', perfil, nota, comentario, id),
      ).rejects.toThrow('Selecciona una calificación');
      expect(tx.resena.create).not.toHaveBeenCalled();
    },
  );

  it.each(['', '   ', '\n\t'])(
    'rechaza un comentario vacío sin guardar la reseña: %j',
    async (texto) => {
      const { servicio, tx } = prepararServicio();
      await expect(
        servicio.publicar('tucume', perfil, 5, texto, id),
      ).rejects.toThrow('Escribe un comentario');
      expect(tx.resena.create).not.toHaveBeenCalled();
    },
  );

  it('impide publicar sin visita verificada aunque se omita la interfaz', async () => {
    const { servicio, tx } = prepararServicio();
    tx.visitaVerificada.findUnique.mockResolvedValue(null);
    await expect(
      servicio.publicar('tucume', perfil, 5, comentario, id),
    ).rejects.toThrow('Verifica tu visita');
    expect(tx.resena.create).not.toHaveBeenCalled();
  });

  it('actualiza el promedio con las reseñas visibles al publicar', async () => {
    const { servicio, tx } = prepararServicio();
    tx.resena.aggregate.mockResolvedValue({ _avg: { calificacion: 4.5 } });
    await servicio.publicar('tucume', perfil, 4, comentario, id);
    expect(tx.resena.aggregate).toHaveBeenCalledWith({
      where: { destinoId: 'destino', retiradaEn: null },
      _avg: { calificacion: true },
    });
    expect(tx.destino.update).toHaveBeenCalledWith({
      where: { id: 'destino' },
      data: { calificacionPromedio: '4.50' },
    });
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

describe('Formulario directo después de verificar el QR', () => {
  it('usa la fecha de la visita autenticada y permite escribir si no hay reseña', async () => {
    const { servicio, cliente, tx } = prepararServicio();
    const fecha = new Date('2026-11-17T15:00:00Z');
    tx.visitaVerificada.findUnique.mockResolvedValue({
      id: 'visita',
      resena: null,
      verificadaEn: fecha,
    });
    const resultado = await servicio.prepararPublicacion('tucume', perfil);
    expect(resultado).toMatchObject({
      estado: 'habilitada',
      fechaVisita: fecha,
      puntosResena: 10,
      puntosSelfie: 5,
    });
    expect(cliente.visitaVerificada.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          usuarioId_destinoId: { usuarioId: perfil.id, destinoId: 'destino' },
        },
      }),
    );
  });

  it('bloquea el formulario cuando no se ha verificado la visita', async () => {
    const { servicio, tx } = prepararServicio();
    tx.visitaVerificada.findUnique.mockResolvedValue(null);
    await expect(
      servicio.prepararPublicacion('tucume', perfil),
    ).resolves.toMatchObject({ estado: 'bloqueada', fechaVisita: null });
  });

  it('reconoce una reseña existente al volver a escanear', async () => {
    const { servicio, tx } = prepararServicio();
    tx.visitaVerificada.findUnique.mockResolvedValue({
      id: 'visita',
      verificadaEn: new Date(),
      resena: { id, retiradaEn: null },
    });
    await expect(
      servicio.prepararPublicacion('tucume', perfil),
    ).resolves.toMatchObject({ estado: 'publicada', resenaId: id });
  });

  it('reserva el formulario de publicación para visitantes', async () => {
    const { servicio, cliente } = prepararServicio();
    await expect(
      servicio.prepararPublicacion('tucume', {
        id: 'encargado',
        rol: 'ADMIN_DESTINO',
      }),
    ).rejects.toThrow('cuenta de visitante');
    expect(cliente.visitaVerificada.findUnique).not.toHaveBeenCalled();
  });
});
