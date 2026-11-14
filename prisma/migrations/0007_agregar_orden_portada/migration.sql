ALTER TABLE "munay"."destinos"
ADD COLUMN "orden_portada" INTEGER CHECK ("orden_portada" > 0);
