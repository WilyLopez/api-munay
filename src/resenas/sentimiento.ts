import type { SentimientoResena } from '../generated/prisma/client.js';
import modelo from './modelo-sentimiento.json' with { type: 'json' };

const vocabulario: Record<string, number> = modelo.vocabulario;
const negacion =
  /(?<![\p{L}\p{N}_])(?:no|nunca|jamás|ni|sin|tampoco)(?![\p{L}\p{N}_])/iu;
const temas = [
  [
    'Atención y guías',
    /\b(?:gu[ií]as?|personal|atenci[oó]n|atendieron|orientaci[oó]n)\b/iu,
  ],
  [
    'Acceso y señalización',
    /\b(?:acceso|señalizaci[oó]n|ruta|transporte|camino|estacionamiento)\b/iu,
  ],
  [
    'Precios y entradas',
    /\b(?:precio|precios|entrada|entradas|tarifa|tarifas|costo|costos)\b/iu,
  ],
  [
    'Conservación y limpieza',
    /\b(?:limpieza|limpios?|limpias?|basura|conservaci[oó]n|mantenimiento)\b/iu,
  ],
  ['Horarios y espera', /\b(?:horarios?|colas?|espera|filas?)\b/iu],
  [
    'Exhibiciones y recorridos',
    /\b(?:salas?|exhibici[oó]n|exposici[oó]n|recorridos?|senderos?)\b/iu,
  ],
] as const;

export function analizarSentimiento(comentario: string) {
  const palabras = comentario.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? [];
  const frecuencias = new Map<number, number>();

  function contar(termino: string) {
    if (!Object.hasOwn(vocabulario, termino)) return;
    const indice = vocabulario[termino];
    frecuencias.set(indice, (frecuencias.get(indice) ?? 0) + 1);
  }

  palabras.forEach((palabra, indice) => {
    contar(palabra);
    if (indice > 0) contar(`${palabras[indice - 1]} ${palabra}`);
  });

  const pesos = Array.from(
    frecuencias,
    ([indice, frecuencia]) =>
      [indice, frecuencia * modelo.idf[indice]] as const,
  );
  const norma =
    Math.sqrt(pesos.reduce((suma, [, peso]) => suma + peso ** 2, 0)) || 1;
  const longitud = (comentario.match(/\S+/gu)?.length ?? 0) / 20;
  const hayNegacion = Number(negacion.test(comentario));
  const dimension = modelo.idf.length;
  const puntuaciones = modelo.coeficientes.map((coeficientes, clase) =>
    pesos.reduce(
      (suma, [indice, peso]) => suma + (coeficientes[indice] * peso) / norma,
      modelo.interceptos[clase] +
        coeficientes[dimension] * longitud +
        coeficientes[dimension + 1] * hayNegacion,
    ),
  );
  const mayor = puntuaciones.indexOf(Math.max(...puntuaciones));

  return {
    sentimiento: modelo.clases[mayor] as SentimientoResena,
    temas: temas
      .filter(([, patron]) => patron.test(comentario))
      .map(([tema]) => tema),
  };
}
