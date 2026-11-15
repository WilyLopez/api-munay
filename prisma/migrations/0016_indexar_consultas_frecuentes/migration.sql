CREATE INDEX "usuarios_rol_activo_idx"
    ON "munay"."usuarios" ("rol", "activo");

CREATE INDEX "destinos_orden_portada_idx"
    ON "munay"."destinos" ("orden_portada");

CREATE INDEX "resenas_puntos_pendientes_creada_en_idx"
    ON "munay"."resenas" ("puntos_pendientes", "creada_en");
