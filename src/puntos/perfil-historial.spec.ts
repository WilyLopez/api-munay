import { describe, expect, it, vi } from 'vitest';
import { PuntosService } from './puntos.service.js';
import type { ServicioPrisma } from '../prisma/prisma.service.js';

function preparar() {
  const visitas = vi.fn().mockResolvedValue([]);
  const resenas = vi.fn().mockResolvedValue([]);
  const respuestas = vi.fn().mockResolvedValue([]);
  const favoritos = vi.fn().mockResolvedValue([]);
  const puntos = vi.fn().mockResolvedValue([]);
  const servicio = new PuntosService({
    cliente: {
      visitaVerificada: { findMany: visitas },
      resena: { findMany: resenas },
      respuestaResena: { findMany: respuestas },
      favorito: { findMany: favoritos },
      movimientoPuntos: { findMany: puntos },
    },
  } as unknown as ServicioPrisma);
  return { servicio, visitas, resenas, respuestas, favoritos, puntos };
}

describe('Actividad privada del visitante', () => {
  it('consulta cada sección únicamente para la cuenta autenticada', async () => {
    const prueba = preparar();
    for (const seccion of [
      'visitas',
      'resenas',
      'respuestas',
      'favoritos',
      'puntos',
    ] as const) {
      await prueba.servicio.historial('mi-cuenta', seccion, 1);
      expect(prueba[seccion]).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ usuarioId: 'mi-cuenta' }),
        }),
      );
    }
  });

  it('solo muestra fotos de reseñas propias que siguen publicadas', async () => {
    const { servicio, resenas } = preparar();
    await servicio.historial('mi-cuenta', 'fotos', 1);
    expect(resenas).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          usuarioId: 'mi-cuenta',
          fotoUrl: { not: null },
          retiradaEn: null,
        },
      }),
    );
  });

  it('conserva doce filas y detecta la siguiente página sin exponer la fila adicional', async () => {
    const { servicio, visitas } = preparar();
    visitas.mockResolvedValue(
      Array.from({ length: 13 }, (_, indice) => ({ id: indice })),
    );
    const resultado = await servicio.historial('mi-cuenta', 'visitas', 2);
    expect(resultado.filas).toHaveLength(12);
    expect(resultado.hayMas).toBe(true);
    expect(visitas).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 12, take: 13 }),
    );
  });

  it('oculta favoritos de atractivos deshabilitados', async () => {
    const { servicio, favoritos } = preparar();
    await servicio.historial('mi-cuenta', 'favoritos', 1);
    expect(favoritos).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          usuarioId: 'mi-cuenta',
          destino: { estadoEditorial: 'publicada' },
        },
      }),
    );
  });
});
