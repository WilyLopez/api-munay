BEGIN;

CREATE TABLE "munay"."sesiones_usuarios" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "ultima_actividad_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revocada_en" TIMESTAMPTZ(3),
    CONSTRAINT "sesiones_usuarios_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sesiones_usuarios_usuario_id_fkey" FOREIGN KEY ("usuario_id")
        REFERENCES "munay"."usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "sesiones_usuarios_usuario_id_idx" ON "munay"."sesiones_usuarios"("usuario_id");

COMMIT;
