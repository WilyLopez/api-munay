ALTER TABLE "munay"."resenas"
ADD COLUMN "retirada_en" TIMESTAMPTZ(3);

ALTER TABLE "munay"."reportes_resenas"
ADD COLUMN "decision" TEXT CHECK ("decision" IN ('mantener', 'retirar')),
ADD COLUMN "motivo_decision" TEXT CHECK (char_length("motivo_decision") BETWEEN 10 AND 500);
