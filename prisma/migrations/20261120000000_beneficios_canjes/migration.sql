CREATE TABLE munay.beneficios (
  id UUID PRIMARY KEY, destino_id UUID NOT NULL REFERENCES munay.destinos(id) ON DELETE RESTRICT,
  nombre TEXT NOT NULL, categoria TEXT NOT NULL CHECK (categoria IN ('GASTRONOMIA','EXPERIENCIAS')),
  local TEXT NOT NULL, condiciones TEXT NOT NULL, horario TEXT NOT NULL,
  costo INTEGER NOT NULL CHECK (costo BETWEEN 1 AND 1000000),
  disponibles INTEGER NOT NULL CHECK (disponibles BETWEEN 0 AND 1000000),
  un_uso BOOLEAN NOT NULL DEFAULT true, activo BOOLEAN NOT NULL DEFAULT false, revision INTEGER NOT NULL DEFAULT 1,
  vence_en TIMESTAMPTZ(3) NOT NULL, creado_en TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX beneficios_activo_vence_en_idx ON munay.beneficios(activo, vence_en);
CREATE INDEX beneficios_destino_id_idx ON munay.beneficios(destino_id);
CREATE TABLE munay.canjes_beneficios (
  id UUID PRIMARY KEY, beneficio_id UUID NOT NULL REFERENCES munay.beneficios(id) ON DELETE RESTRICT,
  usuario_id UUID NOT NULL REFERENCES munay.usuarios(id) ON DELETE RESTRICT,
  codigo TEXT NOT NULL UNIQUE, costo INTEGER NOT NULL CHECK (costo > 0),
  nombre TEXT NOT NULL, local TEXT NOT NULL, condiciones TEXT NOT NULL, horario TEXT NOT NULL,
  creado_en TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, vence_en TIMESTAMPTZ(3) NOT NULL,
  usado_en TIMESTAMPTZ(3), usado_por UUID,
  CONSTRAINT canje_uso_check CHECK ((usado_en IS NULL AND usado_por IS NULL) OR (usado_en IS NOT NULL AND usado_por IS NOT NULL))
);
CREATE INDEX canjes_beneficios_usuario_id_creado_en_id_idx ON munay.canjes_beneficios(usuario_id, creado_en, id);
CREATE INDEX canjes_beneficios_beneficio_id_usuario_id_idx ON munay.canjes_beneficios(beneficio_id, usuario_id);
ALTER TABLE munay.movimientos_puntos ALTER COLUMN resena_id DROP NOT NULL;
ALTER TABLE munay.movimientos_puntos ADD COLUMN canje_id UUID UNIQUE REFERENCES munay.canjes_beneficios(id) ON DELETE RESTRICT;
ALTER TABLE munay.movimientos_puntos DROP CONSTRAINT movimientos_puntos_tipo_signo_check;
ALTER TABLE munay.movimientos_puntos ADD CONSTRAINT movimientos_puntos_tipo_signo_check CHECK (
  (tipo = 'acreditacion' AND puntos > 0 AND resena_id IS NOT NULL AND canje_id IS NULL) OR
  (tipo = 'reversion' AND puntos < 0 AND resena_id IS NOT NULL AND canje_id IS NULL) OR
  (tipo = 'canje' AND puntos < 0 AND canje_id IS NOT NULL AND resena_id IS NULL)
);
