INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('destinos', 'destinos', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE FUNCTION public.munay_puede_subir_foto_destino(carpeta text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM munay.usuarios u
        JOIN munay.destinos d ON d.id::text = carpeta
        WHERE u.id = (SELECT auth.uid()) AND u.activo
            AND (
                u.rol = 'SUPER_ADMIN'
                OR (
                    u.rol = 'ADMIN_DESTINO'
                    AND d.estado_editorial IN ('borrador', 'publicada')
                    AND EXISTS (
                        SELECT 1 FROM munay.administradores_destinos a
                        WHERE a.usuario_id = u.id AND a.destino_id = d.id
                    )
                )
            )
    );
$$;

REVOKE ALL ON FUNCTION public.munay_puede_subir_foto_destino(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.munay_puede_subir_foto_destino(text) TO authenticated;

CREATE POLICY "Munay permite subir fotos del destino asignado"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'destinos'
    AND array_length(storage.foldername(name), 1) = 1
    AND public.munay_puede_subir_foto_destino((storage.foldername(name))[1])
);
