CREATE TABLE "munay"."movimientos_puntos" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "resena_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "puntos" INTEGER NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "movimientos_puntos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "movimientos_puntos_tipo_signo_check" CHECK (("tipo" = 'acreditacion' AND "puntos" > 0) OR ("tipo" = 'reversion' AND "puntos" < 0)),
    CONSTRAINT "movimientos_puntos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "munay"."usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "movimientos_puntos_resena_id_fkey" FOREIGN KEY ("resena_id") REFERENCES "munay"."resenas"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "movimientos_puntos_resena_id_tipo_key" ON "munay"."movimientos_puntos"("resena_id", "tipo");
CREATE INDEX "movimientos_puntos_usuario_id_idx" ON "munay"."movimientos_puntos"("usuario_id");

ALTER TABLE "munay"."resenas" ADD COLUMN "puntos_pendientes" BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE "munay"."resenas" SET "puntos_pendientes" = TRUE WHERE "visita_id" IS NOT NULL AND "retirada_en" IS NULL;
CREATE INDEX "resenas_puntos_pendientes_idx" ON "munay"."resenas"("creada_en", "id") WHERE "puntos_pendientes" AND "retirada_en" IS NULL;
