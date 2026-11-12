INSERT INTO munay.destinos (
    id, slug, nombre, descripcion, ubicacion, categoria, provincia,
    latitud, longitud, imagen_url, actualizado_en
)
SELECT id::uuid, slug, nombre, descripcion, ubicacion, categoria::munay.categoria_destino,
       provincia::munay.provincia_destino, latitud, longitud, imagen_url, CURRENT_TIMESTAMP
FROM (VALUES
    (
        '0786d459-52b1-46a1-8eaa-e40855f1bb70',
        'museo-tumbas-reales-de-sipan',
        'Museo Tumbas Reales de Sipán',
        'Museo arqueológico que conserva los hallazgos de la tumba del Señor de Sipán y presenta la historia de la cultura moche.',
        'Lambayeque, provincia de Lambayeque',
        'CULTURA', 'LAMBAYEQUE', -6.70504, -79.89932, '/destinos/tumbas-reales.webp'
    ),
    (
        'c4a279a9-bd5d-410a-b8a1-0513e2f2b639',
        'complejo-arqueologico-de-tucume',
        'Complejo Arqueológico de Túcume',
        'Conjunto de pirámides de adobe y museo de sitio donde se puede conocer la historia del valle de Lambayeque.',
        'Túcume, provincia de Lambayeque',
        'HISTORIA', 'LAMBAYEQUE', -6.51368, -79.84749, '/destinos/tucume.webp'
    ),
    (
        '66a9ed35-94c4-4cea-a9a3-d6050b6c44b2',
        'santuario-historico-bosque-de-pomac',
        'Santuario Histórico Bosque de Pómac',
        'Área natural protegida donde el bosque seco de algarrobos convive con vestigios arqueológicos de la cultura Sicán.',
        'Pítipo, provincia de Ferreñafe',
        'NATURALEZA', 'FERRENAFE', -6.47361, -79.77639, '/destinos/bosque-de-pomac.webp'
    )
) AS iniciales (id, slug, nombre, descripcion, ubicacion, categoria, provincia, latitud, longitud, imagen_url)
WHERE NOT EXISTS (
    SELECT 1 FROM munay.destinos existentes
    WHERE lower(existentes.nombre) = lower(iniciales.nombre)
)
ON CONFLICT DO NOTHING;

UPDATE munay.destinos AS destino
SET ruta_desde_chiclayo = COALESCE(destino.ruta_desde_chiclayo, datos.ruta),
    distancia_km = COALESCE(destino.distancia_km, datos.distancia),
    duracion_minutos = COALESCE(destino.duracion_minutos, datos.duracion),
    fuente_ruta_url = COALESCE(destino.fuente_ruta_url, datos.fuente),
    recomendacion = COALESCE(destino.recomendacion, datos.recomendacion),
    horario = COALESCE(destino.horario, datos.horario),
    tarifa_general = COALESCE(destino.tarifa_general, datos.tarifa_general),
    tarifa_estudiantes = COALESCE(destino.tarifa_estudiantes, datos.tarifa_estudiantes),
    dias_atencion = CASE
        WHEN cardinality(destino.dias_atencion) = 0
             AND (destino.horario IS NULL OR destino.horario = datos.horario)
        THEN datos.dias
        ELSE destino.dias_atencion
    END
FROM (VALUES
    ('museo-tumbas-reales-de-sipan',
     'Viaja por carretera desde Chiclayo hasta la ciudad de Lambayeque. La entrada está en la avenida Juan Pablo Vizcardo y Guzmán 895.',
     12, 20, 'https://consultasenlinea.mincetur.gob.pe/fichaInventario/index.aspx?cod_Ficha=2352',
     'Si llevas bolsos o mochilas, déjalos en la consigna antes de ingresar a las salas.',
     'Martes a domingo y feriados, de 9:00 a. m. a 5:00 p. m.', 10, 4, ARRAY[2,3,4,5,6,0]),
    ('complejo-arqueologico-de-tucume',
     'Desde Chiclayo, toma la carretera Fernando Belaúnde Terry hasta Túcume y continúa al acceso del complejo arqueológico.',
     35, 45, 'https://consultasenlinea.mincetur.gob.pe/fichaInventario/index.aspx?cod_Ficha=3792',
     NULL, 'Martes a domingo, de 9:00 a. m. a 4:30 p. m.', NULL, NULL, ARRAY[2,3,4,5,6,0]),
    ('santuario-historico-bosque-de-pomac',
     'Viaja desde Chiclayo por Ferreñafe y Pítipo hasta el acceso del santuario.',
     42, 50, 'https://consultasenlinea.mincetur.gob.pe/fichaInventario/index.aspx?cod_Ficha=279',
     'Regístrate al ingresar, lleva protector solar y sigue los senderos señalizados.',
     NULL, NULL, NULL, ARRAY[]::INTEGER[])
) AS datos (slug, ruta, distancia, duracion, fuente, recomendacion, horario, tarifa_general, tarifa_estudiantes, dias)
WHERE destino.slug = datos.slug;

UPDATE munay.destinos AS destino
SET fotos_adicionales = array_append(destino.fotos_adicionales, fotos.url)
FROM (VALUES
    ('museo-tumbas-reales-de-sipan', '/destinos/tumbas-reales-exterior.webp'),
    ('complejo-arqueologico-de-tucume', '/destinos/tucume-museo.webp'),
    ('santuario-historico-bosque-de-pomac', '/destinos/bosque-de-pomac-paisaje.webp')
) AS fotos (slug, url)
WHERE destino.slug = fotos.slug
  AND NOT fotos.url = ANY(destino.fotos_adicionales);
