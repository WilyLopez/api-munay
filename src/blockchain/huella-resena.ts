import { createHash } from 'node:crypto';

export function huellaResena(resena: {
  id: string;
  destinoId: string;
  calificacion: number;
  comentario: string;
}) {
  const contenido = JSON.stringify([
    'munay-resena-v1',
    resena.id,
    resena.destinoId,
    resena.calificacion,
    resena.comentario,
  ]);
  return `0x${createHash('sha256').update(contenido, 'utf8').digest('hex')}`;
}
