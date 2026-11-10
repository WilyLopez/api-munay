import { fileURLToPath } from 'node:url';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class ServicioPrisma implements OnModuleDestroy {
  private clientePrisma?: PrismaClient;

  get cliente(): PrismaClient {
    if (!this.clientePrisma) {
      const cadenaConexion = process.env.DATABASE_URL;

      if (!cadenaConexion) {
        throw new Error('Falta configurar DATABASE_URL.');
      }

      const url = new URL(cadenaConexion);
      const certificado = fileURLToPath(
        new URL('../../prisma/certs/supabase-ca.crt', import.meta.url),
      );

      url.searchParams.set('sslmode', 'verify-full');
      url.searchParams.set('sslrootcert', certificado);

      this.clientePrisma = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: url.toString(),
          connectionTimeoutMillis: 8000,
        }),
      });
    }

    return this.clientePrisma;
  }

  async onModuleDestroy(): Promise<void> {
    await this.clientePrisma?.$disconnect();
  }
}
