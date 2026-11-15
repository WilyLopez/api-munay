import { readFileSync } from 'node:fs';
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
      const certificado = readFileSync(
        new URL('../../prisma/certs/supabase-ca.crt', import.meta.url),
        'utf8',
      );

      for (const parametro of ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey']) {
        url.searchParams.delete(parametro);
      }

      this.clientePrisma = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: url.toString(),
          ssl: { ca: certificado, rejectUnauthorized: true },
          max: process.env.VERCEL === '1' ? 3 : 10,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 10000,
        }),
      });
    }

    return this.clientePrisma;
  }

  async onModuleDestroy(): Promise<void> {
    await this.clientePrisma?.$disconnect();
  }
}
