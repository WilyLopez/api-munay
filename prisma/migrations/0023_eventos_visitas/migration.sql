CREATE FUNCTION munay.notificar_actividad_visitas() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM pg_catalog.pg_notify('munay_visitas', OLD.destino_id::text);
    RETURN OLD;
  END IF;
  PERFORM pg_catalog.pg_notify('munay_visitas', NEW.destino_id::text);
  RETURN NEW;
END;
$$;

CREATE TRIGGER actividad_visitas_verificadas
AFTER INSERT OR UPDATE OR DELETE ON munay.visitas_verificadas
FOR EACH ROW EXECUTE FUNCTION munay.notificar_actividad_visitas();

CREATE TRIGGER actividad_codigos_visita
AFTER INSERT OR UPDATE OR DELETE ON munay.codigos_visita
FOR EACH ROW EXECUTE FUNCTION munay.notificar_actividad_visitas();
