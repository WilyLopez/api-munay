CREATE TABLE munay.analisis_riesgo (
  resena_id UUID PRIMARY KEY REFERENCES munay.resenas(id) ON DELETE CASCADE,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','procesando','completado','fallido')),
  intentos INTEGER NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  proximo_intento_en TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  bloqueado_hasta TIMESTAMPTZ(3), token UUID, modelo TEXT,
  puntaje_modelo INTEGER CHECK (puntaje_modelo BETWEEN 0 AND 100),
  puntaje_reglas INTEGER CHECK (puntaje_reglas BETWEEN 0 AND 100),
  senales JSONB NOT NULL DEFAULT '[]'::jsonb, error TEXT,
  creado_en TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX analisis_riesgo_estado_proximo_intento_en_idx ON munay.analisis_riesgo(estado, proximo_intento_en);
CREATE INDEX analisis_riesgo_bloqueado_hasta_idx ON munay.analisis_riesgo(bloqueado_hasta);
-- El análisis previo se identifica como reglas, no como una predicción del nuevo modelo.
INSERT INTO munay.analisis_riesgo (resena_id, estado, modelo, puntaje_reglas, creado_en, actualizado_en)
SELECT id, 'completado', 'reglas-legado-v1', riesgo, creada_en, creada_en
FROM munay.resenas WHERE riesgo IS NOT NULL;
