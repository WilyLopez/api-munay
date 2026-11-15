CREATE TABLE "munay"."reportes_resenas" (
    "id" UUID NOT NULL,
    "resena_id" UUID NOT NULL,
    "reportada_por" UUID NOT NULL,
    "motivo" TEXT NOT NULL CHECK (char_length("motivo") BETWEEN 10 AND 500),
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revisado_por" UUID,
    "revisado_en" TIMESTAMPTZ(3),
    CONSTRAINT "reportes_resenas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reportes_resenas_resena_id_fkey" FOREIGN KEY ("resena_id") REFERENCES "munay"."resenas"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "reportes_resenas_resena_id_reportada_por_key" ON "munay"."reportes_resenas"("resena_id", "reportada_por");
CREATE INDEX "reportes_resenas_revisado_en_creado_en_id_idx" ON "munay"."reportes_resenas"("revisado_en", "creado_en", "id");
