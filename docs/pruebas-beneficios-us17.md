# US-17 · Evidencia de integración de beneficios

Fecha: 20 de noviembre de 2026. Rama: develop. Ejecución local con PostgreSQL 18, servicio real BeneficiosService y cliente Prisma; sin simular las consultas, bloqueos ni transacciones. No se conectó a Supabase ni se enviaron correos.

## Resultado

7 pruebas de integración aprobadas y 205 pruebas automatizadas de la suite general aprobadas. Lint del backend correcto.

| Escenario | Comprobación | Resultado |
|---|---|---|
| Propuesta y aprobación | Encargado propone sin activar; SuperAdmin aprueba | Aprobado |
| Canje y recuperación | Saldo descontado una vez, comprobante recuperable, mismo código ante reintento | Aprobado |
| Entrega concurrente | Dos validadores compiten; solo uno entrega y se registra una auditoría | Aprobado |
| Autorización | Encargado ajeno no puede entregar el comprobante | Aprobado |
| Último cupo | Dos visitantes compiten; un ganador, inventario cero y sin descuento al perdedor | Aprobado |
| Saldo concurrente | Una cuenta intenta gastar 30 puntos en dos ofertas; un solo canje y saldo cero | Aprobado |
| Solicitud repetida concurrente | Dos llamadas del mismo ID devuelven el mismo comprobante, un descuento y un cupo consumido | Aprobado |
| Fallo durante escritura | Un trigger local provoca error al descontar; rollback de comprobante y reserva, saldo intacto | Aprobado |
| Condiciones cambiadas | Una confirmación anterior al cambio de costo/revisión se rechaza sin descuento | Aprobado |
| Comprobante vencido | Se rechaza entrega sin usadoEn ni auditoría falsa | Aprobado |

Algunos escenarios forman parte de una misma prueba; la suite de integración contiene siete pruebas en total. Las verificaciones de horario ya están cubiertas en las pruebas unitarias.

## Aislamiento y reproducción

Archivos: api-munay/test/beneficios.integration-spec.ts y vitest.config.integration.ts. La prueba no lee DATABASE_URL. Exige BENEFICIOS_TEST_POSTGRES con host 127.0.0.1 o localhost y base de control postgres. Crea una base aleatoria munay_test_*, aplica las 29 migraciones y la elimina al finalizar, también cuando una prueba falla.

Las dependencias DDL de auth/storage se sustituyen por estructuras locales mínimas para aplicar las migraciones. Esto no valida OAuth, permisos de Storage ni servicios externos. Los datos y las promociones de prueba son ficticios y solo existen en la base temporal.

Con PostgreSQL local iniciado, en PowerShell desde api-munay:

```powershell
$env:BENEFICIOS_TEST_POSTGRES = 'postgresql://munay_test@127.0.0.1:55439/postgres'
npm run test:integration
npm test
npm run lint
```

El usuario de pruebas debe poder crear bases locales. Nunca configurar este comando con credenciales de producción. Si el proceso se termina por fuerza antes del cierre, puede quedar una base munay_test_*; revisar el nombre antes de eliminarla.

## Límites pendientes

Son pruebas de integración del servicio y PostgreSQL; no una sesión manual del frontend ni pruebas HTTP/OAuth. Quedan revisión en navegador de propuesta/aprobación, confirmaciones, cámara y QR, recuperación tras autenticación y diseño móvil. Los acuerdos y beneficios reales siguen pendientes. Estas pruebas no cierran por sí solas el Sprint 4.
