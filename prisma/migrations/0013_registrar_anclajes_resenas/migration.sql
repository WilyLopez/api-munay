CREATE TABLE "munay"."anclajes_resenas" (
    "resena_id" UUID NOT NULL,
    "huella" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'pendiente'
        CHECK ("estado" IN ('pendiente', 'enviado', 'confirmado', 'fallido')),
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "contrato" TEXT,
    "transaccion" TEXT,
    "firmada" TEXT,
    "bloque" TEXT,
    "costo_wei" TEXT,
    "error" TEXT,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmado_en" TIMESTAMPTZ(3),
    CONSTRAINT "anclajes_resenas_pkey" PRIMARY KEY ("resena_id"),
    CONSTRAINT "anclajes_resenas_resena_id_fkey" FOREIGN KEY ("resena_id") REFERENCES "munay"."resenas"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "anclajes_resenas_huella_key" ON "munay"."anclajes_resenas"("huella");
CREATE INDEX "anclajes_resenas_estado_creado_en_resena_id_idx" ON "munay"."anclajes_resenas"("estado", "creado_en", "resena_id");
