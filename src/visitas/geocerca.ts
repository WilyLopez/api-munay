import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';

export const RADIO_VISITA_METROS = 100;
type Coordenadas = { latitud: number; longitud: number };

function esCoordenada(valor: unknown, limite: number): valor is number {
  return (
    typeof valor === 'number' &&
    Number.isFinite(valor) &&
    Math.abs(valor) <= limite
  );
}

export function validarGeocerca(destino: Coordenadas, ubicacion: unknown) {
  if (!ubicacion || typeof ubicacion !== 'object') {
    throw new BadRequestException(
      'Necesitamos tu ubicación para verificar la visita.',
    );
  }
  const { latitud, longitud, precision } = ubicacion as Record<string, unknown>;
  if (
    !esCoordenada(latitud, 90) ||
    !esCoordenada(longitud, 180) ||
    !esCoordenada(precision, Number.MAX_VALUE) ||
    precision < 0
  ) {
    throw new BadRequestException(
      'La ubicación recibida no es válida. Intenta nuevamente.',
    );
  }
  if (precision > RADIO_VISITA_METROS) {
    throw new UnprocessableEntityException(
      'La ubicación tiene poca precisión. Acércate a un lugar abierto e intenta nuevamente.',
    );
  }
  const radianes = Math.PI / 180;
  const diferenciaLatitud = (latitud - destino.latitud) * radianes;
  const diferenciaLongitud = (longitud - destino.longitud) * radianes;
  const valor =
    Math.sin(diferenciaLatitud / 2) ** 2 +
    Math.cos(latitud * radianes) *
      Math.cos(destino.latitud * radianes) *
      Math.sin(diferenciaLongitud / 2) ** 2;
  const distancia = 2 * 6371000 * Math.asin(Math.sqrt(Math.min(1, valor)));
  if (distancia > RADIO_VISITA_METROS) {
    throw new UnprocessableEntityException(
      `Estás aproximadamente a ${Math.ceil(distancia)} m del atractivo. Acércate al radio de ${RADIO_VISITA_METROS} m y vuelve a intentarlo.`,
    );
  }
  return {
    distanciaMetros: Math.round(distancia),
    radioMetros: RADIO_VISITA_METROS,
  };
}
