export const nombresIndicadores = [
  'enlaces',
  'promocion',
  'duplicado',
  'similitud',
  'frecuencia_hora',
  'longitud',
  'mayusculas',
  'repeticion',
  'contacto',
] as const;
export type ContextoRiesgo = { comentario: string; creadaEn: Date }[];
export function normalizarRiesgo(texto: string) {
  return texto
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
export function extraerIndicadores(
  comentario: string,
  recientes: ContextoRiesgo,
  ahora: Date,
) {
  const texto = normalizarRiesgo(comentario);
  const palabras = texto.split(/\s+/u).filter((p) => p.length >= 2);
  const unicas = new Set(palabras);
  const letras = Array.from(comentario).filter((c) => /\p{L}/u.test(c));
  const previas = recientes
    .filter(
      (r) =>
        r.creadaEn <= ahora &&
        ahora.getTime() - r.creadaEn.getTime() <= 86400000,
    )
    .slice(0, 20);
  let similitud = 0;
  for (const previa of previas) {
    const otras = new Set(
      normalizarRiesgo(previa.comentario)
        .split(/\s+/u)
        .filter((p) => p.length >= 2),
    );
    const union = new Set([...unicas, ...otras]).size;
    const comunes = [...unicas].filter((p) => otras.has(p)).length;
    if (union) similitud = Math.max(similitud, comunes / union);
  }
  return [
    Math.min(
      (comentario.match(/\b(?:https?:\/\/|www\.)[^\s]+/giu) ?? []).length,
      3,
    ) / 3,
    Number(
      /\b(?:compra ahora|oferta exclusiva|codigo promocional|haz clic|descuento solo hoy)\b/u.test(
        texto,
      ),
    ),
    Number(
      texto.length >= 20 &&
        previas.some((r) => normalizarRiesgo(r.comentario) === texto),
    ),
    similitud,
    Math.min(
      previas.filter((r) => ahora.getTime() - r.creadaEn.getTime() < 3600000)
        .length,
      5,
    ) / 5,
    Math.min(palabras.length, 100) / 100,
    letras.length
      ? letras.filter((c) => c === c.toUpperCase()).length / letras.length
      : 0,
    palabras.length ? 1 - unicas.size / palabras.length : 0,
    Number(/\b(?:whatsapp|telegram)\b|\b\d{9}\b/iu.test(comentario)),
  ];
}
