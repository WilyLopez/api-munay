CREATE TABLE "munay"."resenas" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "destino_id" UUID NOT NULL,
    "visita_id" UUID,
    "calificacion" INTEGER NOT NULL,
    "comentario" TEXT NOT NULL,
    "creada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resenas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "munay"."votos_resenas" (
    "usuario_id" UUID NOT NULL,
    "resena_id" UUID NOT NULL,

    CONSTRAINT "votos_resenas_pkey" PRIMARY KEY ("usuario_id","resena_id")
);

CREATE UNIQUE INDEX "resenas_visita_id_key" ON "munay"."resenas"("visita_id");

CREATE INDEX "resenas_destino_id_creada_en_id_idx" ON "munay"."resenas"("destino_id", "creada_en", "id");

CREATE INDEX "votos_resenas_resena_id_idx" ON "munay"."votos_resenas"("resena_id");

ALTER TABLE "munay"."resenas" ADD CONSTRAINT "resenas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "munay"."usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "munay"."resenas" ADD CONSTRAINT "resenas_destino_id_fkey" FOREIGN KEY ("destino_id") REFERENCES "munay"."destinos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "munay"."resenas" ADD CONSTRAINT "resenas_visita_id_fkey" FOREIGN KEY ("visita_id") REFERENCES "munay"."visitas_verificadas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "munay"."votos_resenas" ADD CONSTRAINT "votos_resenas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "munay"."usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "munay"."votos_resenas" ADD CONSTRAINT "votos_resenas_resena_id_fkey" FOREIGN KEY ("resena_id") REFERENCES "munay"."resenas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "munay"."resenas" ADD CONSTRAINT "resenas_calificacion_check" CHECK ("calificacion" BETWEEN 1 AND 5);
ALTER TABLE "munay"."resenas" ADD CONSTRAINT "resenas_comentario_check" CHECK (char_length(trim("comentario")) BETWEEN 1 AND 2000);
ALTER TABLE "munay"."resenas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "munay"."votos_resenas" ENABLE ROW LEVEL SECURITY;
