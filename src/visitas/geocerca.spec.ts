import { UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { RADIO_VISITA_METROS, validarGeocerca } from './geocerca.js';

const destino = { latitud: -6.7, longitud: -79.8 };

describe('Información de ubicación fuera del radio', () => {
  it('devuelve distancia, radio y código para mostrar el aviso al visitante', () => {
    try {
      validarGeocerca(destino, { latitud: -6.71, longitud: -79.8, precision: 10 });
      expect.fail('La ubicación debería quedar fuera del radio.');
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      const excepcion = error as UnprocessableEntityException;
      expect(excepcion.getStatus()).toBe(422);
      expect(excepcion.getResponse()).toMatchObject({
        codigo: 'FUERA_DEL_RADIO',
        geocerca: { distanciaMetros: expect.any(Number), radioMetros: RADIO_VISITA_METROS },
      });
    }
  });

  it('distingue la falta de precisión de una ubicación fuera del radio', () => {
    try {
      validarGeocerca(destino, { ...destino, precision: 150 });
      expect.fail('La ubicación debería tener precisión insuficiente.');
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).not.toHaveProperty('codigo');
    }
  });

  it('continúa aceptando una ubicación precisa dentro del radio', () => {
    expect(validarGeocerca(destino, { ...destino, precision: 10 })).toEqual({
      distanciaMetros: 0,
      radioMetros: RADIO_VISITA_METROS,
    });
  });
});
