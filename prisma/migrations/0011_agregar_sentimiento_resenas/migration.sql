CREATE TYPE "munay"."sentimiento_resena" AS ENUM ('POSITIVA', 'NEUTRA', 'NEGATIVA');

ALTER TABLE "munay"."resenas"
ADD COLUMN "sentimiento" "munay"."sentimiento_resena",
ADD COLUMN "temas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
