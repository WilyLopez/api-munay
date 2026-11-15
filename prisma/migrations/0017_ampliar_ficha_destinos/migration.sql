ALTER TABLE "munay"."destinos"
    ADD COLUMN "informacion" JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN "estado_editorial" TEXT NOT NULL DEFAULT 'publicada',
    ADD COLUMN "revisado_en" TIMESTAMPTZ(3),
    ADD CONSTRAINT "destinos_estado_editorial_check"
        CHECK ("estado_editorial" IN ('borrador', 'en_revision', 'publicada', 'archivada'));

CREATE INDEX "destinos_estado_editorial_idx" ON "munay"."destinos" ("estado_editorial");
