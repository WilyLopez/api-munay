
CREATE TABLE "munay"."visitas_invitadas" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "token_hash" TEXT NOT NULL,
  "codigo_id" UUID NOT NULL REFERENCES "munay"."codigos_visita"("id") ON DELETE CASCADE,
  "vence_en" TIMESTAMPTZ(3) NOT NULL,
  "verificada_en" TIMESTAMPTZ(3),
  "usuario_id" UUID REFERENCES "munay"."usuarios"("id") ON DELETE CASCADE,
  CONSTRAINT "visitas_invitadas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "visitas_invitadas_token_hash_key" ON "munay"."visitas_invitadas"("token_hash");
CREATE INDEX "visitas_invitadas_vence_en_idx" ON "munay"."visitas_invitadas"("vence_en");
ALTER TABLE "munay"."visitas_invitadas" ENABLE ROW LEVEL SECURITY;
