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

## Pendiente: Windows y archivos asociados

Esta etapa entrega cambios de web a Drive. Todavía no descarga ni aplica los
cambios producidos por Windows, y Windows todavía no consume estos nuevos
lotes. Por eso la interfaz nunca confirma que el escritorio esté sincronizado.
No modifica `.armi-sync`, sus manifiestos ni la base local.

El receptor futuro debe convertir identificadores a las referencias portables
del escritorio y comparar versiones y valores anteriores antes de aplicar.
Un lote con valor anterior desconocido requiere reconciliación; no autoriza
sobrescribir el trabajo local. Se necesita además un acuse de recepción de
Windows y una cola de archivos asociada a cada trabajo, con verificación de
integridad. Las entregas del portal estudiantil aún no forman parte de esta cola.

## Verificación

Las pruebas cubren separación por docente, agrupación, rollback transaccional,
reintentos sin duplicar, cambios nuevos durante un envío, cambio de carpeta,
sesiones desactualizadas y ejecución de la entrega en workerd. No sustituyen
una prueba de sincronización completa con Windows, que sigue pendiente.
