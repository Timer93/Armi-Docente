# Sincronización automática del trabajo

## Disponible en esta etapa

Los guardados de datos generales, estudiantes, planificación, configuración,
instrumentos y evaluación registran sus cambios en una cola por docente dentro
de la misma transacción de guardado. Las ediciones repetidas se agrupan.

Con Drive conectado y la página abierta, ARMI envía los cambios en lotes tras
una espera de 30 segundos. No consulta Drive continuamente. Si se cierra la
página antes de enviar, la cola permanece en D1 y se retoma al volver a abrir.
Un fallo conserva los pendientes y ofrece reintentar; no elimina el trabajo.

Cada lote se guarda como un archivo JSON nuevo en `ARMI Web Sync`, dentro de la
carpeta elegida por ese docente. Un reintento usa el mismo identificador para
evitar duplicados. No incluye claves de IA, contraseñas ni tokens de Google.
Puede contener información académica y personal de estudiantes, como el DNI.
Desconectar Drive no elimina estos archivos: se administran desde Google Drive.

## Activación en D1

Aplicar una vez `migrations/0013_automatic_sync_outbox.sql` en la base vinculada
al Worker, después de las migraciones anteriores. Reaplicar este archivo no
vuelve a enviar los registros ya confirmados. No requiere otro secreto OAuth.

Desde PowerShell, en la carpeta del proyecto:

```powershell
Get-Content -Raw web/migrations/0013_automatic_sync_outbox.sql | Set-Clipboard
```

Pegar todo en la consola de D1 de `armi-docente-web` y ejecutar. Recargar la web.
Sin esta migración la app conserva sus guardados habituales y muestra que falta
activar la sincronización, sin prometer envíos.

## Recepción en Windows

La actualización de escritorio incorpora `backend/webDesktopBridge.js` al ciclo
existente de carpeta espejo, con un máximo de una pasada cada 30 segundos. Antes
del primer lote crea `sync-runtime/restore-points/before-web-receiver.db`. El
receptor compara los campos editados con su valor anterior, conserva ediciones
locales independientes y vincula estudiantes por DNI o por una correspondencia
previamente verificada, nunca por coincidencia de número de fila.

Puede recibir datos generales, estudiantes, sesiones, unidades, programación,
configuración, instrumentos, notas y conclusiones. Los borrados, las identidades
ambiguas, los campos sin conversión y los conflictos permanecen pendientes.
Un lote antiguo sin valor anterior verificable no puede reemplazar una fila
local existente. Los nuevos envíos incluyen la base académica importada cuando
está disponible. Los mensajes viejos ya escritos en Drive no se modifican.

Windows escribe confirmaciones por lote en `ARMI Web Sync/receipts`. La web ofrece
«Comprobar Windows» para consultar la confirmación del último envío; no consulta
Google continuamente ni interpreta «enviado» como «aplicado». La confirmación
incluye conflictos y no permite afirmar que las dos versiones completas sean
idénticas. Las tablas `web_work_*` son locales y se excluyen de la replicación.

Para la instalación existente, preparar con
`node scripts/prepare-web-desktop-bridge.mjs`. Esto valida los puntos de integración
contra el archivo instalado y genera `artifacts/ARMI-Actualizacion-Sincronizacion-Web`.
El docente debe guardar y cerrar ARMI, ejecutar `Instalar.cmd` y volver a abrirlo.
El instalador verifica hashes, respalda el cargador y añade un módulo aislado;
no reemplaza la aplicación completa ni incluye bases de datos o credenciales.

## Plantillas de actividades y evidencias

Windows publica únicamente el catálogo y HTML de plantillas en
`ARMI Web Sync/templates`, con archivos de contenido inmutable identificados por
SHA-256. No incluye respuestas ni historiales de estudiantes. La web valida
carpeta, propietario, sesión y hash antes de mostrarlo. La vista previa es aislada,
sin scripts, permisos del navegador ni conexiones externas. La edición y la
ejecución colaborativa de esas actividades continúan en Windows.

## Pendiente

La actualización no implementa el regreso de cambios académicos de Windows a D1,
la sincronización de contraseñas ni las subidas automáticas de archivos adjuntos.
Las entregas del portal estudiantil aún no forman parte de esta cola. No modifica
manifiestos ni reescribe los archivos internos `.armi-sync`.

## Verificación

Las pruebas cubren separación por docente, agrupación, rollback transaccional,
reintentos sin duplicar, cambios nuevos durante un envío, cambio de carpeta,
sesiones desactualizadas y ejecución de la entrega en workerd. No sustituyen
la prueba con la instalación real después de reiniciarla. Las pruebas del receptor
usan bases aisladas e incluyen el cargador empaquetado.
