export const UMBRAL_RIESGO_RESENA = 70;

function normalizar(texto: string) {
  return texto
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function evaluarRiesgoResena(
  comentario: string,
  recientes: { comentario: string; creadaEn: Date }[],
  ahora: Date,
) {
  const motivos: string[] = [];
  let riesgo = 0;
  const texto = normalizar(comentario);
  const enlaces = (comentario.match(/\b(?:https?:\/\/|www\.)[^\s]+/giu) ?? [])
    .length;
  if (
    texto.length >= 20 &&
    recientes.some((resena) => normalizar(resena.comentario) === texto)
  ) {
    riesgo += 75;
    motivos.push(
      'El mismo comentario se publicó recientemente en otro atractivo.',
    );
  }
  if (enlaces) {
    riesgo += enlaces > 1 ? 75 : 40;
    motivos.push(
      enlaces > 1
        ? 'El comentario contiene varios enlaces externos.'
        : 'El comentario contiene un enlace externo.',
    );
  }
  if (
    enlaces &&
    /\b(?:compra ahora|oferta exclusiva|codigo promocional|haz clic|descuento solo hoy)\b/u.test(
      texto,
    )
  ) {
    riesgo += 35;
    motivos.push(
      'El comentario combina enlaces externos con frases promocionales.',
    );
  }
  if (
    recientes.filter(
      ({ creadaEn }) => ahora.getTime() - creadaEn.getTime() < 60 * 60 * 1000,
    ).length >= 4
  ) {
    riesgo += 35;
    motivos.push('La cuenta publicó varias reseñas en menos de una hora.');
  }
  return { riesgo: Math.min(riesgo, 100), motivo: motivos.join(' ') };
}
