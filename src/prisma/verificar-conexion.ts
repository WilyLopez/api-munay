import { NestFactory } from '@nestjs/core';
import { PrismaModule } from './prisma.module.js';
import { ServicioPrisma } from './prisma.service.js';

async function verificarConexion(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('Falta configurar DATABASE_URL.');
    process.exitCode = 1;
    return;
  }

  const aplicacion = await NestFactory.createApplicationContext(PrismaModule, {
    logger: false,
  });

  try {
    const prisma = aplicacion.get(ServicioPrisma);
    const [resultado] = await prisma.cliente.$queryRaw<{ valor: number }[]>`
      SELECT 1 AS valor
    `;

    if (resultado?.valor !== 1) {
      throw new Error('Resultado inesperado.');
    }

    console.log(
      'Conexión con Supabase verificada mediante Prisma. SELECT 1 devolvió 1.',
    );
  } finally {
    await aplicacion.close();
  }
}

await verificarConexion().catch(() => {
  console.error('No se pudo verificar la conexión con Supabase.');
  process.exitCode = 1;
});
