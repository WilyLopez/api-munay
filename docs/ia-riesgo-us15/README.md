# US-15 · Detector integrado, piloto académico

Regresión logística binaria sobre nueve indicadores de texto y frecuencia: enlaces, promoción, duplicado, similitud, publicaciones en una hora, longitud, mayúsculas, repetición y contacto. No utiliza estrellas ni sentimiento; una opinión negativa no equivale a manipulación.

## Evidencia reproducible

El CSV contiene 120 variantes de 40 escenarios sintéticos, no 120 observaciones independientes. Las etiquetas fueron diseñadas para el piloto. Se separaron grupos completos: 96 variantes de entrenamiento y 24 de prueba. El modelo obtuvo 21 aciertos: matriz [[12, 0], [3, 9]], con filas esperadas y columnas predichas [sin_indicios, revisar]. La combinación exploratoria con reglas obtuvo 18 aciertos y añadió falsos positivos; por ello las reglas se muestran como contexto y el modelo decide la alerta. Esta selección exploratoria requiere evaluación final independiente; no se acredita fiabilidad con turistas reales ni una probabilidad calibrada de fraude.

Abre riesgo-resenas-munay.ipynb en Google Colab y sigue sus celdas. Sube el CSV y entrenar.py. El archivo evaluacion.json conserva métricas, grupos y huella del dataset. modelo-riesgo.json conserva los coeficientes y versión. Los fixtures comprueban la equivalencia entre Python y TypeScript. El cuaderno público anterior de sentimiento no fue modificado.

## Funcionamiento en el sistema

La publicación guarda reseña y trabajo de análisis en una transacción. La API procesa una cola persistente en PostgreSQL: en Render cada 15 segundos, además de la notificación inmediata. El endpoint de tareas existente también procesa la cola. En despliegues sin servidor se necesita invocar esa tarea con su autenticación existente. No se despliega Colab ni un entorno Python; no hay nuevos secretos. RIESGO_ML_HABILITADO=false deshabilita deliberadamente el análisis y conserva pendientes para reintento.

Un índice redondeado mayor que 70 crea una alerta privada para el SuperAdmin. No oculta automáticamente la reseña. Los puntos permanecen pendientes hasta completar el análisis y, si corresponde, la revisión humana. Se respetan retiros y decisiones anteriores. Las reseñas históricas con riesgo previo quedan identificadas como reglas-legado-v1; no se presentan como evaluadas por el nuevo modelo.

Los trabajos tienen bloqueo de dos minutos, token de propiedad y cinco intentos con espera creciente. Los errores conservan el contenido. En /superadmin/reportes, pestaña Cola de análisis, se muestran estados, intentos, versión y reintento manual de fallos. Solo SuperAdmin accede. Los bloqueos impiden que un trabajador atrasado sobrescriba otro o cambie una decisión humana.

Migración: 20261120020000_analisis_riesgo_us15. Antes de desplegar el código, aplicar prisma migrate deploy. Blockchain permanece aplazado.

## Pendiente para cerrar

Datos reales anonimizados y etiquetados con revisión humana, evaluación independiente, calibración y revisión de falsos positivos/negativos. Prueba funcional completa publicación → análisis → alerta → decisión → puntos, y prueba de concurrencia con PostgreSQL en un entorno aislado. No se da el sprint por cerrado con pruebas unitarias.
