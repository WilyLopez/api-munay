# Munay API

API de Munay con NestJS y TypeScript. Usa Node.js 24 para el desarrollo local.

## Desarrollo local

```sh
npm ci
npm run start:dev
```

La API arranca en [el puerto 3001](http://localhost:3001). Si aún no tienes un archivo `.env`, crea uno a partir de `.env.example`. Puedes cambiar el puerto mediante `PORT` en ese archivo o en el entorno del proceso.

## Conexión con Supabase

Guarda en `.env` la URI PostgreSQL de **Connect → Session pooler** como `DATABASE_URL`. La API verifica el certificado y el nombre del servidor con la CA pública de Supabase incluida en `prisma/certs`.

```sh
npm run build
npm run db:verify
```

El comando ejecuta `SELECT 1` con Prisma desde un contexto de NestJS. El cliente se genera con `npm run prisma:generate`.

## Migraciones

La CLI usa `DIRECT_URL`. Para probar las migraciones, configura esa variable con la conexión a una base PostgreSQL de desarrollo aislada y selecciona el esquema `munay` mediante el parámetro `schema=munay`. En Supabase de desarrollo se usa el *Session pooler* con `sslmode=require`, `sslaccept=strict` y `sslcert` apuntando al archivo `prisma/certs/supabase-ca.crt` mediante su ruta absoluta.

```sh
npm exec -- prisma migrate deploy
npm exec -- prisma migrate status
npm run prisma:generate
```

Las migraciones crean las tablas de perfiles, destinos, asignaciones de encargados, favoritos y sesiones en el esquema `munay`. Mantén ese esquema fuera de los esquemas expuestos por la API de datos de Supabase.

## Autenticación

Configura `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` con el proyecto de Supabase que usa la web. Los métodos `POST`, `GET` y `DELETE` de `/autenticacion/sesion` requieren un token de Supabase en el encabezado `Authorization`. NestJS valida la identidad y que el correo esté confirmado. La primera sesión crea un perfil con rol `TURISTA` si aún no existe.

Munay invalida el acceso tras 30 minutos sin solicitudes autenticadas y revoca la sesión de la aplicación al cerrar sesión. Los permisos del usuario se consultan en el perfil de Munay.

## Verificación

```sh
npm run lint
npm run build
npm test
npm run test:e2e
```
