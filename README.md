# Munay API

API de Munay con NestJS y TypeScript. Usa Node.js 24 para el desarrollo local.

## Desarrollo local

```sh
npm ci
npm run start:dev
```

La API arranca en [el puerto 3001](http://localhost:3001). Si aún no tienes un archivo `.env`, crea uno a partir de `.env.example`. Puedes cambiar el puerto mediante `PORT` en ese archivo o en el entorno del proceso.

## Verificación

```sh
npm run lint
npm run build
npm test
npm run test:e2e
```
