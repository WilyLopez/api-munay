
ALTER TABLE "munay"."resenas"
ADD COLUMN "foto_url" TEXT,
ADD COLUMN "selfie_declarada" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "munay"."respuestas_resenas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "resena_id" UUID NOT NULL REFERENCES "munay"."resenas"("id") ON DELETE CASCADE,
    "usuario_id" UUID NOT NULL REFERENCES "munay"."usuarios"("id") ON DELETE CASCADE,
    "comentario" TEXT NOT NULL CHECK (char_length("comentario") BETWEEN 1 AND 1000),
    "creada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retirada_en" TIMESTAMPTZ(3),
    CONSTRAINT "respuestas_resenas_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "respuestas_resenas_resena_id_creada_en_id_idx"
ON "munay"."respuestas_resenas"("resena_id", "creada_en", "id");
CREATE INDEX "respuestas_resenas_usuario_id_creada_en_idx"
ON "munay"."respuestas_resenas"("usuario_id", "creada_en");
ALTER TABLE "munay"."respuestas_resenas" ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('resenas', 'resenas', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE FUNCTION public.munay_puede_subir_foto_resena(usuario text, destino text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
SELECT EXISTS (
  SELECT 1 FROM munay.usuarios u
  JOIN munay.visitas_verificadas v ON v.usuario_id = u.id
  JOIN munay.destinos d ON d.id = v.destino_id
  WHERE u.id = (SELECT auth.uid()) AND u.id::text = usuario
    AND u.activo AND u.rol = 'TURISTA' AND d.id::text = destino
    AND d.estado_editorial = 'publicada'
    AND NOT EXISTS (SELECT 1 FROM munay.resenas r WHERE r.visita_id = v.id)
);
$$;
REVOKE ALL ON FUNCTION public.munay_puede_subir_foto_resena(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.munay_puede_subir_foto_resena(text, text) TO authenticated;

CREATE POLICY "Munay permite subir una foto de visita verificada"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'resenas'
  AND array_length(storage.foldername(name), 1) = 2
  AND public.munay_puede_subir_foto_resena(
    (storage.foldername(name))[1], (storage.foldername(name))[2]
  )
);
