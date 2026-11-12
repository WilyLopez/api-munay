ALTER TABLE "munay"."destinos" ADD COLUMN "slug" TEXT;

WITH nombres AS (
    SELECT id, COALESCE(NULLIF(TRIM(BOTH '-' FROM regexp_replace(
        lower(translate(nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
        '[^a-z0-9]+', '-', 'g'
    )), ''), 'destino') AS base
    FROM "munay"."destinos"
), ordenados AS (
    SELECT id, base, row_number() OVER (PARTITION BY base ORDER BY id) AS posicion
    FROM nombres
)
UPDATE "munay"."destinos" AS destino
SET slug = CASE WHEN ordenados.posicion = 1 THEN ordenados.base
               ELSE ordenados.base || '--' || destino.id::text END
FROM ordenados
WHERE destino.id = ordenados.id;

ALTER TABLE "munay"."destinos" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "destinos_slug_key" ON "munay"."destinos"("slug");
