import modelo from './modelo-riesgo.json' with { type: 'json' };
import {
  extraerIndicadores,
  nombresIndicadores,
  type ContextoRiesgo,
} from './indicadores-riesgo.js';
import { evaluarRiesgoResena, UMBRAL_RIESGO_RESENA } from './riesgo-resena.js';

export const informacionDetector = {
  version: modelo.version,
  origen: modelo.origen,
  umbral: UMBRAL_RIESGO_RESENA,
  evaluacion: modelo.evaluacion,
};
const etiquetas = [
  'enlaces externos',
  'lenguaje promocional',
  'texto repetido en reseñas anteriores',
  'similitud con publicaciones previas',
  'frecuencia de publicación',
  'longitud del comentario',
  'uso de mayúsculas',
  'repetición de palabras',
  'datos de contacto',
];
export function detectarRiesgo(
  comentario: string,
  recientes: ContextoRiesgo,
  ahora: Date,
) {
  if (process.env.RIESGO_ML_HABILITADO === 'false')
    throw new Error('Detector temporalmente deshabilitado.');
  if (
    modelo.coeficientes.length !== nombresIndicadores.length ||
    modelo.indicadores.join('|') !== nombresIndicadores.join('|') ||
    !Number.isFinite(modelo.intercepto) ||
    modelo.coeficientes.some((v) => !Number.isFinite(v))
  )
    throw new Error('El artefacto del detector no es válido.');
  const indicadores = extraerIndicadores(comentario, recientes, ahora);
  const contribuciones = modelo.coeficientes.map(
    (peso, i) => peso * indicadores[i],
  );
  const puntuacion = contribuciones.reduce(
    (suma, n) => suma + n,
    modelo.intercepto,
  );
  const probabilidad =
    puntuacion >= 0
      ? 1 / (1 + Math.exp(-puntuacion))
      : Math.exp(puntuacion) / (1 + Math.exp(puntuacion));
  const puntajeModelo = Math.round(probabilidad * 100);
  const reglas = evaluarRiesgoResena(comentario, recientes, ahora);
  // Las reglas se conservan como contexto: en la prueba sintética añadían falsos positivos al combinarlas con el modelo.
  const riesgo = puntajeModelo;
  const senales = contribuciones
    .map((valor, i) => ({ valor, etiqueta: etiquetas[i] }))
    .filter((s) => s.valor > 0.05)
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 3)
    .map((s) => s.etiqueta);
  return {
    riesgo,
    puntajeModelo,
    puntajeReglas: reglas.riesgo,
    modelo: modelo.version,
    senales,
    sospechosa: riesgo > UMBRAL_RIESGO_RESENA,
    motivo: [
      reglas.motivo,
      senales.length
        ? `Señales del modelo experimental: ${senales.join(', ')}.`
        : 'El modelo requiere revisión del contexto.',
    ]
      .filter(Boolean)
      .join(' '),
  };
}
