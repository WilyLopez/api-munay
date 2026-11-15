CREATE TABLE "munay"."accesos_encargados" (
  "id" UUID NOT NULL PRIMARY KEY,
  "tipo" TEXT NOT NULL CHECK ("tipo" IN ('invitacion','solicitud')),
  "estado" TEXT NOT NULL DEFAULT 'pendiente' CHECK ("estado" IN ('pendiente','aprobada','rechazada','revocada')),
  "correo" TEXT NOT NULL,
  "usuario_id" UUID,
  "destino_id" UUID REFERENCES "munay"."destinos"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "motivo" TEXT,
  "contacto" TEXT,
  "propuesta" JSONB,
  "token_hash" TEXT,
  "vence_en" TIMESTAMPTZ(3),
  "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resuelto_en" TIMESTAMPTZ(3),
  "resuelto_por" UUID,
  "observacion" TEXT
);
CREATE UNIQUE INDEX "accesos_encargados_token_hash_key" ON "munay"."accesos_encargados"("token_hash");
CREATE INDEX "accesos_encargados_estado_creado_en_id_idx" ON "munay"."accesos_encargados"("estado","creado_en","id");
CREATE INDEX "accesos_encargados_usuario_id_creado_en_idx" ON "munay"."accesos_encargados"("usuario_id","creado_en");
