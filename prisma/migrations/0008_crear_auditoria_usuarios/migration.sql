CREATE TABLE "munay"."auditorias_usuarios" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "accion" TEXT NOT NULL,
    "cambios" JSONB NOT NULL,
    "creada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auditorias_usuarios_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auditorias_usuarios_usuario_id_creada_en_idx"
ON "munay"."auditorias_usuarios"("usuario_id", "creada_en");
