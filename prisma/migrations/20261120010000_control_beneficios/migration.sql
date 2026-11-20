ALTER TABLE munay.beneficios
  ADD COLUMN estado TEXT NOT NULL DEFAULT 'pendiente',
  ADD COLUMN tipo TEXT NOT NULL DEFAULT 'EXPERIENCIA',
  ADD COLUMN valor INTEGER,
  ADD COLUMN inicia_en TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN limite_por_persona INTEGER DEFAULT 1,
  ADD COLUMN dias INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN hora_inicio TEXT,
  ADD COLUMN hora_fin TEXT,
  ADD COLUMN consumo_minimo INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN exclusiones TEXT NOT NULL DEFAULT '',
  ADD COLUMN reserva_previa BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN acumulable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN aprobado_en TIMESTAMPTZ(3),
  ADD COLUMN aprobado_revision INTEGER;
UPDATE munay.beneficios SET estado = CASE WHEN activo THEN 'publicado' ELSE 'pendiente' END,
  limite_por_persona = CASE WHEN un_uso THEN 1 ELSE NULL END,
  aprobado_revision = CASE WHEN activo THEN revision ELSE NULL END,
  aprobado_en = CASE WHEN activo THEN actualizado_en ELSE NULL END,
  inicia_en = LEAST(creado_en, vence_en - interval '1 millisecond');
ALTER TABLE munay.beneficios
  ADD CONSTRAINT beneficio_estado_check CHECK (estado IN ('borrador','pendiente','publicado','pausado')),
  ADD CONSTRAINT beneficio_activo_check CHECK (activo = (estado = 'publicado')),
  ADD CONSTRAINT beneficio_valor_check CHECK (
    (tipo = 'PORCENTAJE' AND valor IS NOT NULL AND valor BETWEEN 1 AND 100) OR
    (tipo = 'IMPORTE' AND valor IS NOT NULL AND valor BETWEEN 1 AND 100000000) OR
    (tipo IN ('ENTRADA','EXPERIENCIA') AND valor IS NULL)),
  ADD CONSTRAINT beneficio_limite_check CHECK (limite_por_persona IS NULL OR limite_por_persona BETWEEN 1 AND 100),
  ADD CONSTRAINT beneficio_vigencia_check CHECK (inicia_en < vence_en),
  ADD CONSTRAINT beneficio_minimo_check CHECK (consumo_minimo BETWEEN 0 AND 100000000),
  ADD CONSTRAINT beneficio_dias_check CHECK (dias <@ ARRAY[0,1,2,3,4,5,6]),
  ADD CONSTRAINT beneficio_horas_check CHECK ((hora_inicio IS NULL AND hora_fin IS NULL) OR (hora_inicio IS NOT NULL AND hora_fin IS NOT NULL AND hora_inicio ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND hora_fin ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND hora_inicio < hora_fin));
ALTER TABLE munay.canjes_beneficios ADD COLUMN detalle JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE munay.auditorias_beneficios (
  id UUID PRIMARY KEY, beneficio_id UUID NOT NULL REFERENCES munay.beneficios(id) ON DELETE RESTRICT,
  actor_id UUID NOT NULL REFERENCES munay.usuarios(id) ON DELETE RESTRICT, accion TEXT NOT NULL,
  canje_id UUID, cambios JSONB NOT NULL, creada_en TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX auditorias_beneficios_beneficio_id_creada_en_id_idx ON munay.auditorias_beneficios(beneficio_id, creada_en, id);
CREATE INDEX auditorias_beneficios_canje_id_idx ON munay.auditorias_beneficios(canje_id);
