import { ServicioPrisma } from '../prisma/prisma.service.js';
import { analizarSentimiento } from './sentimiento.js';

const prisma = new ServicioPrisma();
let total = 0;

try {
  const cliente = prisma.cliente;
  for (;;) {
    const filas = await cliente.resena.findMany({
      where: { sentimiento: null, retiradaEn: null },
      orderBy: { id: 'asc' },
      take: 25,
      select: { id: true, comentario: true },
    });
    if (!filas.length) break;
    for (const fila of filas) {
      const actualizado = await cliente.resena.updateMany({
        where: { id: fila.id, sentimiento: null, retiradaEn: null },
        data: analizarSentimiento(fila.comentario),
      });
      total += actualizado.count;
    }
  }
  console.log(`Reseñas existentes clasificadas: ${total}.`);
} catch {
  console.error(
    'La clasificación de reseñas no pudo completarse. Puedes ejecutar el comando nuevamente.',
  );
  process.exitCode = 1;
} finally {
  await prisma.onModuleDestroy();
}
