BEGIN;

CREATE SCHEMA IF NOT EXISTS "munay";

CREATE TYPE "munay"."rol_usuario" AS ENUM ('SUPER_ADMIN', 'ADMIN_DESTINO', 'TURISTA');

CREATE TYPE "munay"."categoria_destino" AS ENUM ('HISTORIA', 'CULTURA', 'NATURALEZA', 'PLAYAS');

CREATE TYPE "munay"."provincia_destino" AS ENUM ('CHICLAYO', 'LAMBAYEQUE', 'FERRENAFE');

CREATE TABLE "munay"."usuarios" (
    "id" UUID NOT NULL,
    "nombre_completo" TEXT NOT NULL,
    "rol" "munay"."rol_usuario" NOT NULL DEFAULT 'TURISTA',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "munay"."destinos" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "ubicacion" TEXT NOT NULL,
    "categoria" "munay"."categoria_destino" NOT NULL,
    "provincia" "munay"."provincia_destino" NOT NULL,
    "latitud" DOUBLE PRECISION NOT NULL,
    "longitud" DOUBLE PRECISION NOT NULL,
    "imagen_url" TEXT,
    "horario" TEXT,
    "tarifa_general" DECIMAL(10,2),
    "tarifa_estudiantes" DECIMAL(10,2),
    "calificacion_promedio" DECIMAL(3,2),
    "verificado" BOOLEAN NOT NULL DEFAULT false,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "destinos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "munay"."administradores_destinos" (
    "usuario_id" UUID NOT NULL,
    "destino_id" UUID NOT NULL,
    "asignado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "administradores_destinos_pkey" PRIMARY KEY ("usuario_id","destino_id")
);

CREATE TABLE "munay"."favoritos" (
    "usuario_id" UUID NOT NULL,
    "destino_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favoritos_pkey" PRIMARY KEY ("usuario_id","destino_id")
);

CREATE INDEX "destinos_provincia_categoria_idx" ON "munay"."destinos"("provincia", "categoria");

CREATE INDEX "destinos_categoria_idx" ON "munay"."destinos"("categoria");

CREATE INDEX "administradores_destinos_destino_id_idx" ON "munay"."administradores_destinos"("destino_id");

CREATE INDEX "favoritos_destino_id_idx" ON "munay"."favoritos"("destino_id");

ALTER TABLE "munay"."administradores_destinos" ADD CONSTRAINT "administradores_destinos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "munay"."usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "munay"."administradores_destinos" ADD CONSTRAINT "administradores_destinos_destino_id_fkey" FOREIGN KEY ("destino_id") REFERENCES "munay"."destinos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "munay"."favoritos" ADD CONSTRAINT "favoritos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "munay"."usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "munay"."favoritos" ADD CONSTRAINT "favoritos_destino_id_fkey" FOREIGN KEY ("destino_id") REFERENCES "munay"."destinos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "munay"."destinos"
    ADD CONSTRAINT "destinos_latitud_valida" CHECK ("latitud" BETWEEN -90 AND 90),
    ADD CONSTRAINT "destinos_longitud_valida" CHECK ("longitud" BETWEEN -180 AND 180),
    ADD CONSTRAINT "destinos_tarifa_general_valida" CHECK ("tarifa_general" >= 0),
    ADD CONSTRAINT "destinos_tarifa_estudiantes_valida" CHECK ("tarifa_estudiantes" >= 0),
    ADD CONSTRAINT "destinos_calificacion_promedio_valida" CHECK ("calificacion_promedio" BETWEEN 1 AND 5);

COMMIT;
