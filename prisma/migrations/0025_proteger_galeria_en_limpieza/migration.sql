CREATE OR REPLACE FUNCTION public.munay_puede_retirar_foto_destino(archivo text)
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
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.informacion->'galeria') = 'array' THEN d.informacion->'galeria' ELSE '[]'::jsonb END) foto
        WHERE right(foto->>'url', length('/storage/v1/object/public/destinos/' || archivo)) = '/storage/v1/object/public/destinos/' || archivo
      )
  );
$$;
