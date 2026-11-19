# Munay API

API de Munay con NestJS y TypeScript. Usa Node.js 24 para el desarrollo local.

## Desarrollo local

```sh
npm ci
npm run start:dev
```

La API arranca en [el puerto 3001](http://localhost:3001). Si aún no tienes un archivo `.env`, crea uno a partir de `.env.example`. Puedes cambiar el puerto mediante `PORT` en ese archivo o en el entorno del proceso.

## Despliegue en Render

Usa un **Web Service** con Node.js 24.x. El comando de compilación es `npm ci --include=dev && npm run build` y el de arranque es `npm run start:prod`. Render proporciona `PORT`. Configura `DATABASE_URL`, `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` en **Environment**. Aplica las migraciones en Supabase y comprueba que `/destinos` responde en el dominio de Render.

NestJS procesa las tareas pendientes mientras el servicio está activo. Si usas un programador externo, configura `CRON_SECRET` e invoca `GET /interno/tareas` con `Authorization: Bearer <CRON_SECRET>`. Añade las tres variables `BLOCKCHAIN_*` cuando tengas listo el contrato de Sepolia.

Para enviar invitaciones a encargados, configura `MUNAY_WEB_URL` con el dominio HTTPS del frontend, `RESEND_API_KEY` con una clave de envío y `RESEND_REMITENTE` con una dirección de un dominio verificado. El SuperAdmin puede copiar el enlace privado si Resend no lo envía. En desarrollo local, la URL predeterminada es `http://localhost:3000`.

## Conexión con Supabase

Las migraciones amplían los destinos, crean el bucket público `destinos` y limitan a una asignación por encargado. La subida de fotos requiere una cuenta activa y acceso al destino. Antes de aplicar la restricción, verifica si hay encargados con asignaciones múltiples y conserva la que corresponda desde el panel de SuperAdmin.

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

## Catálogo de destinos

`GET /destinos` permite consultar el catálogo público. Cuando recibe un token válido, incluye la sesión y el estado de los favoritos de esa cuenta. Los métodos `PUT` y `DELETE` de `/destinos/:id/favorito` requieren una sesión activa.

Para cargar los destinos iniciales en la base configurada mediante `DIRECT_URL`, aplica primero las migraciones y ejecuta `npm exec -- prisma db execute --file prisma/datos/destinos-iniciales.sql`. El script se puede repetir sin duplicar sus destinos ni reemplazar registros existentes.

## Verificación

```sh
npm run lint
npm run build
npm test
npm run test:e2e
```


### Actividad de visitas en tiempo real

El panel QR recibe avisos SSE del endpoint administrativo de visitas. La migración `0023_eventos_visitas` agrega notificaciones PostgreSQL para visitas verificadas y códigos QR. El listener requiere `DIRECT_URL` de conexión directa o Session pooler (puerto 5432); el Transaction pooler de 6543 no se utiliza para LISTEN. Reutiliza la validación TLS de Prisma y no requiere nuevas claves.

El flujo se limita al destino autorizado y transporta únicamente avisos de actualización. Cada conexión dura hasta 45 segundos y se vuelve a autenticar al reconectar. Si el listener pierde conexión, el frontend informa la sincronización periódica de respaldo. Las conexiones y temporizadores se cierran al abandonar la pantalla o detener la API.
