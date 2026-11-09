# Corrección de republicaciones durante fallos de recepción

## Estado

Corrección implementada y actualización preparada. Todavía no instalada en PC 1 ni PC 2. La sesión de trabajo no tiene permisos de administrador para reemplazar archivos en Program Files. Falta recibir el diagnóstico local de PC 2 y verificar el fallo que bloquea su recepción antes de declarar reparada la sincronización completa.

## Cambio

El motor guarda un diario local con el lote, su identificador original y el estado que lo confirma antes de publicar. Si falla Drive o la escritura del estado, el siguiente intento termina esa misma publicación antes de construir otra. Una excepción al recibir cambios ya no deshace la confirmación de los envíos completados.

Esto se aplica tanto a cambios capturados al comenzar como a ediciones que llegan durante una recepción. Se conserva la importación inicial pendiente cuando un ciclo se interrumpe. Los eventos disponen de su propio presupuesto de lectura para que los catálogos de recuperación lentos no consuman todo su turno. El último error técnico se guarda en `sync-runtime/incremental-last-error.json`.

No se borraron paquetes antiguos, no se marcaron como recibidos sin procesarlos y no se modificaron notas, sesiones ni evidencias originales.

## Verificación

- Prueba nueva: tres fallos consecutivos de recepción, reinicio del motor entre intentos, una edición posterior válida y recepción desde otro equipo.
- Fallos simulados de escritura en Drive y del estado local: recuperación con el mismo identificador de lote y contenido intacto.
- Pruebas existentes de sincronización incremental, ediciones concurrentes, inventario lento, protección de planificación, referencias de identidad y conciliación revisada: aprobadas.
- El test de inventario necesitó desactivar su observador antes de la limpieza: Node podía reutilizar la función interceptada desde su eliminación interna de temporales. No se cambió su comprobación del funcionamiento del servidor.
- Actualización construida a partir de la aplicación instalada: se contrastaron los 13.061 archivos. Solo cambia `backend/incrementalMirrorSync.js`; los archivos nativos externos mantienen sus huellas.
- Scripts PowerShell analizados sin errores de sintaxis.

## Archivos

Respaldo consistente de PC 1 y estados: `recovery-candidates/sync-repair-2026-10-26/`. SQLite confirmó `quick_check=ok`. También se conservaron los catálogos remotos disponibles; esto no sustituye el respaldo de la base local de PC 2 y sus evidencias recién recibidas.

Actualización y manifiesto: `recovery-candidates/sync-repair-2026-10-26/update/`.

Copia compartida: `.armi-sync/diagnostics/actualizacion-sync/` en el espejo configurado. Incluye `app.asar`, `manifest.json` e `instalar.ps1`. El instalador exige ARMI cerrada, permisos de administrador, huella exacta de la aplicación original y verificación del archivo descargado. Respalda la aplicación y la base local antes del reemplazo atómico y no inicia ARMI.

Recogida de diagnóstico de PC 2: `.armi-sync/diagnostics/recoger-pc2.ps1`. Requiere ARMI cerrada, conserva una copia local de base/WAL/estado y envía una copia al espejo para reproducir el error sobre datos aislados. No modifica los datos originales.

## Pendiente

Recibir y examinar el diagnóstico de PC 2, reproducir y resolver cualquier fallo adicional de recepción, aplicar la actualización y comprobar que las dos computadoras reciben los recursos y evidencias conservados. No basta con instalar la prevención de duplicados para dar por revisados los miles de paquetes ya existentes.

## Diagnóstico de PC 2 recibido y fallo reproducido

Se recibió `pc2-20261026-205510`, se verificaron todas las huellas del inventario y se creó `pc2/consistent.db` mediante SQLite Backup API. `quick_check=ok`. Los originales compartidos se conservaron intactos.

El estado de PC 2 se había detenido en la secuencia 9657. En la reproducción aislada el motor falló al calcular la huella de la caché local `armi_hybrid_numeric_scores_v1`: `Referencia local de estudiante sin resolver: 108`. La excepción se producía dentro de la transacción de recepción, en la comparación de una fila local, fuera del control que protege las operaciones entrantes con identidad no resuelta. La transacción completa se revertía y la confirmación del envío anterior no llegaba a guardarse.

Se corrigió ese punto: una identidad local no resoluble conserva su fila y su operación pendiente, mientras otras operaciones válidas pueden recibirse. Se añadió una regresión con una caché que referencia al estudiante 108 ausente: el contenido queda intacto, llega un registro ajeno a esa caché y no se repiten los envíos.

La copia de PC 2 contiene 4.112 valores de caché: 3.373 coinciden con registros oficiales y 739 no tienen una clave equivalente en esos registros. No se borraron ni convirtieron a identidades supuestas. La preservación de esa caché explica que continúen existiendo algunos pendientes protegidos después de destrabar la recepción.

Tras incorporar en el espejo aislado todos los lotes de PC 1 que el estado de PC 2 no había reconocido, un ciclo incorporó 1.636 operaciones adicionales y el siguiente incorporó cero y publicó cero. Quedaron 11 operaciones protegidas en esa prueba: cinco de identidad y seis del formato anterior. No se hicieron pasar por resueltas. Se usó una muestra de lotes del propio emisor repetitivo, no sus 13.618 paquetes sin reconocer completos; esta prueba no certifica el tiempo total de procesamiento del historial real.

La verificación de la copia recuperada confirmó los enlaces de imagen y Word de los quince recursos de las cinco sesiones del 25/10. No faltó ninguna clave de evidencia original de PC 2; las catorce evidencias con fecha de envío dentro del intervalo examinado del 26/10 permanecen presentes. La caché protegida quedó exactamente igual. Detalle: `pc2-replay/verification.json`.

Los registros de PC 2 también contienen errores `database is locked` del conciliador de evidencias, incluso anteriores a octubre. No se atribuye ese mensaje al fallo de identidad reproducido ni se ha identificado el proceso que causaba esos bloqueos históricos.

La actualización se reconstruyó y verificó de nuevo tras incluir esta segunda corrección. Sigue pendiente aplicarla y comprobar ambas aplicaciones reales; la recepción y la reproducción del diagnóstico ya están completadas.

## Paquete específico de PC 2

El primer intento de instalación en PC 2 se detuvo sin cambios porque su archivo original no coincidía con la huella de PC 1. Se recogió y verificó su propia aplicación: SHA-256 `9ce07f967eaae10244c15c7267db3b496986a79f1153cfc0ee1f9eed91f69767`. Ambas indican versión 11.4.15, pero difieren en catorce archivos empaquetados. El módulo incremental original sí era idéntico.

Se generó un paquete dedicado en `.armi-sync/diagnostics/actualizacion-sync-pc2/`. Cambia exclusivamente el módulo revisado, comprobando los 13.064 archivos del archivo original. Conserva exactamente los descriptores de los 170 archivos nativos externos y el resto del contenido empaquetado. Para no reconstruir ni sustituir binarios nativos, el generador conserva el cuerpo original del archivo, añade el módulo corregido y actualiza únicamente su entrada del encabezado y sus huellas. Se contrastaron todas las extracciones empaquetadas con la biblioteca oficial ASAR.

Huella del paquete dedicado: `8d39246887adb7a161d431810b7a0d1db09e5fe40b6078f29a9e8afa96f1a1ab`. El instalador mantiene la exigencia de coincidencia exacta con el original de PC 2 y el respaldo previo. No se debilitó el control para aceptar aplicaciones distintas.

## Instalación y recepción real confirmadas por PC 2

El instalador informó éxito y respaldo en `C:\Users\DOCENTE\AppData\Roaming\ARMI Docente\repair-backups\sync-hotfix-20261026-212126`. Las muestras posteriores mostraron descenso de 13.781 pendientes, con cero publicaciones nuevas en las muestras observadas. El usuario confirmó que los recursos aparecieron al alcanzar aproximadamente 5.000 pendientes y que finalmente quedaron once.

Los once coinciden con la reproducción aislada: seis cambios antiguos de preferencias/calendario y cinco bloqueos relacionados con la caché y referencias antiguas. La caché original tiene 737 claves cuyos estudiantes ya no están en el padrón actual y otras dos sin registro oficial equivalente. Se conserva íntegra; no se asignan esos valores a otros estudiantes por coincidencia de números.

Se probó regenerar exclusivamente la caché desde `evaluacion_registros` y conservar su versión completa y todas las alternativas en archivos de recuperación. El motor normal incorporó los comprobantes de conciliación existentes y pasó de once a cero pendientes, con dos ciclos consecutivos `in-sync`. No se vació ni modificó manualmente su lista de lotes aplicados.

El helper `scripts/reconcile-numeric-cache.cjs` se probó sobre una copia: 4.112 entradas anteriores, 3.373 notas oficiales y 748 alternativas conservadas en archivo (incluyen nueve diferencias con registros oficiales incorporados durante la prueba). Comprobó mediante huellas que estudiantes, notas, conclusiones, evidencias, asistencias y sesiones quedaron iguales antes y después. Hace un respaldo SQLite consistente y utiliza una transacción inmediata para evitar interferencias; aborta si una nota oficial no tiene estudiante verificable.

Preparado para ejecución con ARMI cerrada en PC 2: `.armi-sync/diagnostics/conciliar-cache-pc2.ps1`. Utiliza el runtime y SQLite de la instalación existente, no necesita Python ni nuevas dependencias y conserva recibo de comprobación en el espejo. La conciliación real todavía requiere esa ejecución y la posterior comprobación de estado.
