CREATE TABLE "munay"."codigos_visita" (
    "id" UUID NOT NULL,
    "destino_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vence_en" TIMESTAMPTZ(3) NOT NULL,
    "anulado_en" TIMESTAMPTZ(3),
    "usado_en" TIMESTAMPTZ(3),
    CONSTRAINT "codigos_visita_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "codigos_visita_destino_id_fkey" FOREIGN KEY ("destino_id")
        REFERENCES "munay"."destinos"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "munay"."visitas_verificadas" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "destino_id" UUID NOT NULL,
    "codigo_id" UUID NOT NULL,
    "verificada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "visitas_verificadas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "visitas_verificadas_usuario_id_fkey" FOREIGN KEY ("usuario_id")
        REFERENCES "munay"."usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "visitas_verificadas_destino_id_fkey" FOREIGN KEY ("destino_id")
        REFERENCES "munay"."destinos"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "visitas_verificadas_codigo_id_fkey" FOREIGN KEY ("codigo_id")
        REFERENCES "munay"."codigos_visita"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "codigos_visita_destino_id_creado_en_idx"
    ON "munay"."codigos_visita"("destino_id", "creado_en");
CREATE UNIQUE INDEX "visitas_verificadas_codigo_id_key"
    ON "munay"."visitas_verificadas"("codigo_id");
CREATE UNIQUE INDEX "visitas_verificadas_usuario_id_destino_id_key"
    ON "munay"."visitas_verificadas"("usuario_id", "destino_id");
CREATE INDEX "visitas_verificadas_destino_id_verificada_en_id_idx"
    ON "munay"."visitas_verificadas"("destino_id", "verificada_en", "id");

ALTER TABLE "munay"."codigos_visita" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "munay"."visitas_verificadas" ENABLE ROW LEVEL SECURITY;
