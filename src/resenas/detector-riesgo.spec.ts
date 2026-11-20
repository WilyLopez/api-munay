import { describe, expect, it, vi } from 'vitest';
import { extraerIndicadores } from './indicadores-riesgo.js';
import { detectarRiesgo, informacionDetector } from './detector-riesgo.js';
import indicadores from './fixtures-indicadores-riesgo.json' with { type: 'json' };
import predicciones from './fixtures-predicciones-riesgo.json' with { type: 'json' };

describe('Equivalencia del detector Python y TypeScript', () => {
  it.each(indicadores.map((caso, i) => ({ ...caso, numero: i + 1 })))(
    'extrae los mismos indicadores del escenario $numero',
    (caso) => {
      const vector = extraerIndicadores(
        caso.texto,
        caso.anteriores.map((r) => ({ ...r, creadaEn: new Date(r.creadaEn) })),
        new Date(caso.ahora),
      );
      vector.forEach((n, i) => expect(n).toBeCloseTo(caso.indicadores[i], 10));
    },
  );
  it('reproduce los índices de los 24 casos reservados y la evaluación guardada', () => {
    let aciertos = 0;
    for (const caso of predicciones) {
      const resultado = detectarRiesgo(
        caso.texto,
        caso.anteriores.map((r) => ({ ...r, creadaEn: new Date(r.creadaEn) })),
        new Date(caso.ahora),
      );
      expect(resultado.puntajeModelo).toBe(caso.puntajeEsperado);
      expect(resultado.riesgo).toBe(resultado.puntajeModelo);
      if (Number(resultado.sospechosa) === caso.etiqueta) aciertos++;
    }
    expect(aciertos / predicciones.length).toBe(
      informacionDetector.evaluacion.modelo.exactitud,
    );
  });
  it('no marca una crítica por ser negativa y no usa la calificación como entrada', () => {
    const resultado = detectarRiesgo(
      'El acceso fue caro y no me gustó la visita. Faltan rampas y sombra.',
      [],
      new Date(),
    );
    expect(resultado.sospechosa).toBe(false);
  });
  it('falla de forma controlada si el detector está deshabilitado', () => {
    vi.stubEnv('RIESGO_ML_HABILITADO', 'false');
    try {
      expect(() =>
        detectarRiesgo('Una visita interesante.', [], new Date()),
      ).toThrow('deshabilitado');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
