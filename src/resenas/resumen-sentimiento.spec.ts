import { describe, expect, it, vi } from 'vitest';
import { ResenasService } from './resenas.service.js';
import type { ServicioPrisma } from '../prisma/prisma.service.js';
import type { PuntosService } from '../puntos/puntos.service.js';
import type { DestinosService } from '../destinos/destinos.service.js';

describe('Resumen de sentimiento actualizado', () => {
  it('vuelve a consultar al publicar o moderar, sin conservar el resumen anterior', async () => {
    const consulta = vi
      .fn()
      .mockResolvedValueOnce([
        { total: 1, positivas: 1, neutras: 0, negativas: 0, temas: [] },
      ])
      .mockResolvedValueOnce([
        { total: 2, positivas: 1, neutras: 0, negativas: 1, temas: ['Acceso'] },
      ]);
    const servicio = new ResenasService(
      { cliente: { $queryRaw: consulta } } as unknown as ServicioPrisma,
      {} as PuntosService,
      {} as DestinosService,
    );
    expect(await servicio.resumenSentimiento('museo')).toMatchObject({
      total: 1,
      actualizadoEn: expect.any(String),
    });
    expect(await servicio.resumenSentimiento('museo')).toMatchObject({
      total: 2,
      negativas: 1,
    });
    expect(consulta).toHaveBeenCalledTimes(2);
    const sql = consulta.mock.calls[0][0].join(' ');
    expect(sql).toContain("d.estado_editorial = 'publicada'");
    expect(sql).toContain('r.retirada_en IS NULL');
    expect(consulta.mock.calls[0][1]).toBe('museo');
  });
});
