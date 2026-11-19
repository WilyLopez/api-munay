import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import { AppModule } from './app.module.js';

async function bootstrap() {
  if (existsSync('.env')) {
    loadEnvFile('.env');
  }

  const app = await NestFactory.create(AppModule);
  app.use(
    compression({
      filter: (peticion, respuesta) =>
        peticion.headers.accept?.includes('text/event-stream')
          ? false
          : compression.filter(peticion, respuesta),
    }),
  );
  if (process.env.VERCEL !== '1') app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT || 3001));
}
await bootstrap();
