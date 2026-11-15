ALTER TABLE "munay"."resenas"
    ADD COLUMN "riesgo" INTEGER CHECK ("riesgo" BETWEEN 0 AND 100);

ALTER TABLE "munay"."reportes_resenas"
    ALTER COLUMN "reportada_por" DROP NOT NULL,
    ADD COLUMN "riesgo" INTEGER CHECK ("riesgo" BETWEEN 0 AND 100),
    ADD CONSTRAINT "reportes_resenas_origen_check"
    CHECK (("reportada_por" IS NOT NULL AND "riesgo" IS NULL)
        OR ("reportada_por" IS NULL AND "riesgo" IS NOT NULL));

CREATE UNIQUE INDEX "reportes_resenas_alerta_automatica_key"
    ON "munay"."reportes_resenas" ("resena_id") WHERE "reportada_por" IS NULL;

CREATE INDEX "resenas_usuario_id_creada_en_idx"
    ON "munay"."resenas" ("usuario_id", "creada_en");
