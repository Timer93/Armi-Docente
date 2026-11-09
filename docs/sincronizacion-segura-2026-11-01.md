# Sincronización eficiente y mantenimiento seguro

Implementación del 1 de noviembre de 2026. Los cambios están en el código fuente; no se han instalado en las dos PC ni aplicado a los archivos del Drive real durante estas pruebas.

## Envíos más pequeños

Cada evento conserva sus operaciones y las referencias que necesita para identificar estudiantes, instrumentos y evidencias en otra PC. El catálogo de recuperación continúa completo. Ante un contenido que no puede interpretarse con certeza, se conserva el catálogo correspondiente.

Una muestra del respaldo existente pasó de 276.728 a 1.420 bytes (99,49 % menos). Se comprobó en una copia de la base receptora que la operación decodificada era idéntica. Es un ejemplo medido, no una reducción garantizada para todos los envíos ni para los archivos adjuntos.

El diario local de publicación conserva el mismo identificador de evento al reintentar un envío fallido; el mantenimiento complementa esa prevención revisando repeticiones anteriores.

## Depuración automática conservadora

Solo se retiran eventos del propio dispositivo con contenido equivalente, incluyendo operaciones, relojes de versión y referencias. Se excluyen únicamente el identificador, la secuencia y la fecha del envoltorio al comparar. Las versiones distintas, eliminaciones, catálogos de recuperación y eventos únicos permanecen compartidos. El formato antiguo y los eventos del calendario aprobado quedan excluidos de la depuración.

Condiciones predeterminadas:

- Antigüedad mínima de siete días; análisis gradual de hasta 16 archivos y retiro de hasta cuatro por revisión, como máximo una revisión por minuto.
- Comprobante de otra PC que haya incorporado todo el inventario visible de eventos. Una PC desconectada puede seguir guardando y publicando; la falta de comprobante aplaza la depuración.
- Tanto el evento repetido como el equivalente conservado deben estar incorporados en esta PC. Se protege el último envío publicado.
- Archivo comprimido fuera del espejo, en `history-archive` dentro de la carpeta local de ejecución. Se descomprime y verifica su SHA-256 antes de retirar la repetición. Un recibo registra el archivo original y el equivalente conservado.
- Relectura de ambas copias y autorización del proceso principal inmediatamente antes del retiro. Cambiar de espejo, detener la sincronización, encontrar un archivo dudoso o no disponer de espacio aplaza el mantenimiento.

La revisión de archivos se ejecuta en un proceso separado, sin acceso a SQLite, para que una demora de Drive no ocupe los trabajadores de archivos del servidor. Se limita su tiempo de ejecución y no se acumulan revisiones simultáneas.

El archivo local es una protección adicional. La otra PC y una PC nueva siguen recuperándose del historial compartido, que conserva todos los eventos únicos y un representante de cada repetición retirada. No necesitan acceder a los respaldos locales de otra computadora.

No se compacta el historial único mediante un punto de restauración global, no se depuran adjuntos y no se rotan ni eliminan automáticamente los archivos locales de seguridad. El historial puede seguir creciendo cuando contiene información nueva. Retirar un archivo del espejo tampoco demuestra que Google haya liberado cuota: su papelera puede seguir ocupando espacio; ARMI no la vacía automáticamente.

## Estado de sincronización

El panel y el detalle del indicador distinguen datos guardados en esta PC, último envío preparado en la carpeta de Drive, comprobación directa de servidores de Google y recepción de datos en otras PC.

Los comprobantes se publican después de incorporar los eventos. Un archivo visible en la carpeta local, Drive abierto o la ausencia de transferencias no demuestran subida a los servidores. La comprobación directa de Google permanece expresamente sin verificar. Los comprobantes entre PC cubren cambios de la base de datos; los adjuntos mantienen su verificación por separado. Si hay cambios locales pendientes se oculta la confirmación correspondiente al envío anterior.

Una versión que no reconoce una tabla o un campo entrante mantiene ese evento pendiente para una actualización compatible. Agregar columnas nulas durante una actualización no debe convertirse en una edición ficticia que reemplace datos recibidos.

## Validación y activación

Pruebas con bases temporales y copias de respaldos, sin operar sobre la base instalada ni Drive real:

- `npm run test:sync-efficiency`: referencias compactas, comprobantes reales, cambios concurrentes y sin conexión, recepción por cliente anterior, incompatibilidad de esquema, recuperación en PC nueva y mantenimiento con archivo verificado.
- Pruebas de identidad de referencias y calificaciones, migraciones, reintentos de publicación, escrituras concurrentes, historial duplicado, tombstones, colas y aislamiento de tareas antiguas.
- Pruebas del indicador, controles de transferencia y presentación de comprobantes.
- Pruebas de rendimiento del inventario, historial y estado; `npm run typecheck`; `npm run build`.

Para activarlo en uso diario se debe preparar e instalar la actualización en ambas PC. Una versión anterior no emite estos comprobantes y no habilita por sí sola la depuración protegida de la nueva versión. Antes de instalar, conservar el respaldo existente y verificar la misma carpeta espejo y la convergencia de ambas PC.

Los módulos principales son `backend/syncBatchReferences.js`, `backend/syncDeliveryReceipts.js`, `backend/syncHistoryMaintenance.js` y `backend/workers/syncHistoryMaintenanceWorker.js`; su integración está en `backend/incrementalMirrorSync.js`. La presentación compartida está en `components/SyncDeliveryDetails.tsx`.
