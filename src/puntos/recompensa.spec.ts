import { describe, expect, it, vi } from 'vitest';
import { PuntosService } from './puntos.service.js';
import type { ServicioPrisma } from '../prisma/prisma.service.js';

function preparar(
  movimientos: { tipo: string; puntos: number; creadoEn: Date }[] = [],
  retiradaEn: Date | null = null,
) {
  const consulta = vi.fn().mockResolvedValue({
    creadaEn: new Date('2026-11-20T12:00:00Z'),
    retiradaEn,
    fotoUrl: 'https://ejemplo.test/selfie.jpg',
    selfieDeclarada: true,
    destino: { nombre: 'Museo', slug: 'museo' },
    movimientosPuntos: movimientos,
  });
  const servicio = new PuntosService({
    cliente: { resena: { findFirst: consulta } },
  } as unknown as ServicioPrisma);
  return { servicio, consulta };
}
describe('Comprobante privado de recompensa', () => {
  it('consulta únicamente una reseña propia y no presenta puntos pendientes como acreditados', async () => {
    const { servicio, consulta } = preparar();
    expect(await servicio.recompensa('mi-cuenta', 'mi-resena')).toMatchObject({
      estado: 'pendiente',
      total: 0,
      previstos: 15,
      puntosResena: 0,
      puntosSelfie: 0,
    });
    expect(consulta).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'mi-resena', usuarioId: 'mi-cuenta' },
      }),
    );
  });
  it('desglosa el movimiento realmente acreditado en reseña y selfie', async () => {
    const fecha = new Date('2026-11-20T12:01:00Z');
    const { servicio } = preparar([
      { tipo: 'acreditacion', puntos: 15, creadoEn: fecha },
    ]);
    expect(await servicio.recompensa('mi-cuenta', 'mi-resena')).toMatchObject({
      estado: 'acreditada',
      total: 15,
      puntosResena: 10,
      puntosSelfie: 5,
      registradoEn: fecha,
    });
  });
  it('no inventa un bono si solo hay diez puntos en el registro', async () => {
    const { servicio } = preparar([
      { tipo: 'acreditacion', puntos: 10, creadoEn: new Date() },
    ]);
    expect(await servicio.recompensa('cuenta', 'resena')).toMatchObject({
      total: 10,
      puntosSelfie: 0,
    });
  });
  it('no muestra recompensa activa después de una reversión', async () => {
    const { servicio } = preparar([
      { tipo: 'acreditacion', puntos: 15, creadoEn: new Date() },
      { tipo: 'reversion', puntos: -15, creadoEn: new Date() },
    ]);
    expect(await servicio.recompensa('cuenta', 'resena')).toMatchObject({
      estado: 'revertida',
      total: 0,
      previstos: 0,
    });
  });
  it('oculta reseñas inexistentes o de otra cuenta', async () => {
    const { servicio, consulta } = preparar();
    consulta.mockResolvedValueOnce(null);
    await expect(servicio.recompensa('cuenta', 'ajena')).rejects.toThrow(
      'no está disponible',
    );
  });
});
