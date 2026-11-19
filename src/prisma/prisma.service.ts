import { configuracionPostgres } from './configuracion-postgres.js';
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

      this.clientePrisma = new PrismaClient({
        adapter: new PrismaPg({
          ...configuracionPostgres(cadenaConexion),
          max: process.env.VERCEL === '1' ? 3 : 10,
          idleTimeoutMillis: 30000,
        }),
      });
    }

    return this.clientePrisma;
  }

  async onModuleDestroy(): Promise<void> {
    await this.clientePrisma?.$disconnect();
  }
}
