ALTER TABLE "munay"."destinos"
    ADD COLUMN "fotos_adicionales" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "dias_atencion" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    ADD COLUMN "ruta_desde_chiclayo" TEXT,
    ADD COLUMN "distancia_km" INTEGER,
    ADD COLUMN "duracion_minutos" INTEGER,
    ADD COLUMN "recomendacion" TEXT,
    ADD COLUMN "fuente_ruta_url" TEXT;
