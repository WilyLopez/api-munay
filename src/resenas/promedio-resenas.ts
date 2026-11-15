import type { Prisma } from '../generated/prisma/client.js';

export async function actualizarPromedioResenas(
  tx: Prisma.TransactionClient,
  destinoId: string,
) {
  const resumen = await tx.resena.aggregate({
    where: { destinoId, retiradaEn: null },
    _avg: { calificacion: true },
  });
  await tx.destino.update({
    where: { id: destinoId },
    data: {
      calificacionPromedio: resumen._avg.calificacion?.toFixed(2) ?? null,
    },
  });
}
