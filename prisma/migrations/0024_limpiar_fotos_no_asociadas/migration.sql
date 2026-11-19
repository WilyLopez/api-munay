CREATE FUNCTION public.munay_puede_retirar_foto_destino(archivo text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM munay.destinos d
    WHERE d.id::text = split_part(archivo, '/', 1)
      AND public.munay_puede_subir_foto_destino(d.id::text)
      AND (d.imagen_url IS NULL OR right(d.imagen_url, length('/storage/v1/object/public/destinos/' || archivo)) <> '/storage/v1/object/public/destinos/' || archivo)
      AND NOT EXISTS (
        SELECT 1 FROM unnest(d.fotos_adicionales) foto
        WHERE right(foto, length('/storage/v1/object/public/destinos/' || archivo)) = '/storage/v1/object/public/destinos/' || archivo
      )
  );
$$;
REVOKE ALL ON FUNCTION public.munay_puede_retirar_foto_destino(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.munay_puede_retirar_foto_destino(text) TO authenticated;
CREATE POLICY "Munay permite retirar fotos no asociadas del destino asignado"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'destinos' AND public.munay_puede_retirar_foto_destino(name));
CREATE POLICY "Munay permite eliminar fotos no asociadas del destino asignado"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'destinos' AND public.munay_puede_retirar_foto_destino(name));
