CREATE TABLE "munay"."permisos_visita" (
    "codigo_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "vence_en" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "permisos_visita_pkey" PRIMARY KEY ("codigo_id", "usuario_id"),
    CONSTRAINT "permisos_visita_codigo_id_fkey" FOREIGN KEY ("codigo_id")
        REFERENCES "munay"."codigos_visita"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "permisos_visita_usuario_id_fkey" FOREIGN KEY ("usuario_id")
        REFERENCES "munay"."usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "permisos_visita_usuario_id_vence_en_idx"
    ON "munay"."permisos_visita"("usuario_id", "vence_en");
ALTER TABLE "munay"."permisos_visita" ENABLE ROW LEVEL SECURITY;

CREATE INDEX "visitas_verificadas_codigo_id_idx"
    ON "munay"."visitas_verificadas"("codigo_id");
DROP INDEX "munay"."visitas_verificadas_codigo_id_key";
