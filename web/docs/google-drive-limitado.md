# Google Drive por docente: carpeta y subcarpetas

Actualizado el 24 de noviembre de 2026. Sustituye el flujo anterior de autorización archivo por archivo.

## Estado real

Se solicita `https://www.googleapis.com/auth/drive openid email`. Google concede acceso general de gestión a Drive: no limita este permiso a una carpeta. ARMI aplica el límite en el servidor: comprueba la raíz vinculada y la ascendencia de los archivos antes de listarlos, descargarlos, previsualizarlos o aceptar selecciones. Elegir otra raíz es una acción explícita del docente. Una raíz no puede compartirse entre cuentas ARMI.

Esto permite consultar los archivos existentes y nuevos accesibles para esa cuenta dentro de la raíz y sus subcarpetas sin autorizarlos uno por uno. Se navega por niveles, con paginación de 50 elementos y actualización manual, sin sondeo ni descarga automática de todo el árbol.

Esta versión permite lectura y subida de archivos nuevos de hasta 5 MB al destino elegido dentro de la carpeta. No habilita reemplazo, edición, eliminación, creación automática de carpetas ni sincronización académica con Windows. Los binarios descargables están limitados a 100 MB; los documentos nativos de Google aún no tienen exportación. Los datos académicos web siguen en D1 y el login sigue en Sheets/Apps Script. El escritorio permanece intacto.

## Configuración pendiente en Google Cloud

1. Abrir el proyecto **Armi Docente Cloud** (`armi-docente-cloud`).
2. En **Google Auth Platform → Acceso a los datos → Agregar o quitar permisos**, declarar `https://www.googleapis.com/auth/drive`, además de identidad y correo. `drive.file` ya no es suficiente.
3. Revisar **Centro de verificación**. `drive` es restringido: la verificación de la marca no aprueba este alcance. Completar la justificación y los requisitos de Google, indicando que el Worker transmite contenido para descarga/vista previa.
4. Google indica que almacenar o transmitir datos de permisos restringidos en servidores requiere una evaluación de seguridad. Este diseño transmite archivos por el Worker. No prometer aprobación inmediata o gratuita: la evaluación puede implicar costos externos. No contratarla ni activar facturación sin autorización del propietario. Una app sin aprobación puede mostrar avisos, límites o bloqueos; ponerla En producción no los elimina.
5. Conservar el cliente **ARMI Web**, origen `https://web.armiapp.com`, y redirección `https://web.armiapp.com/api/drive/oauth/callback`. No cambiar secretos ni generar otro EXE.
6. Publicado el código, cada conexión anterior debe volver a autorizar desde **Google Drive → Actualizar permisos de Google**. Con la misma cuenta Google se conserva la carpeta elegida; otra cuenta la desvincula. Los tokens antiguos no se amplían silenciosamente.

El alcance se guarda dentro del token cifrado. Tokens antiguos sin alcance registrado se tratan como pendientes de autorización. No se necesita otra migración SQL. Hasta renovar el consentimiento, se bloquean las consultas a Drive y se muestra la acción necesaria; el resto de ARMI sigue disponible.

Referencias oficiales: [Permisos y evaluación de seguridad](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Verificación restringida](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

## Configuración existente y controles

Mantener Drive API y Picker API habilitadas. Mantener los secretos `ARMI_GOOGLE_CLIENT_ID`, `ARMI_GOOGLE_CLIENT_SECRET`, `ARMI_GOOGLE_PROJECT_NUMBER`, `ARMI_GOOGLE_PICKER_API_KEY` y `ARMI_DRIVE_ENCRYPTION_KEY` fuera del repositorio. La clave de Picker debe restringirse a Picker API y a `https://web.armiapp.com/*` y `https://docs.google.com/*`. No reemplazar la clave de cifrado: impediría abrir las conexiones guardadas. Se conservan las tablas de `0012_drive_connection.sql`.

OAuth mantiene PKCE, estado de un solo uso asociado a sesión/docente y caducidad. Tokens cifrados con AES-GCM y datos asociados al docente; guardados con control de revisión. Desvincular no elimina archivos de Drive. El secreto OAuth y el token de renovación nunca salen del servidor.

El selector aislado recibe el token breve del docente en memoria; con este cambio también tiene permiso general. Conservar su política de scripts, aislamiento y prohibición de registrar o persistir el token. La ventana principal y los estudiantes no lo reciben. El servidor comprueba la raíz aunque Google permita consultar el resto del Drive.

## Carpeta por usuario

Para Windows se elige la carpeta del usuario dentro de `ARMI Sync/users/<syncUserKey>` en Drive. Un usuario nuevo puede elegir una carpeta propia o crearla manualmente antes. La web todavía no crea el espejo. La ruta local no permite deducir el ID de Drive. Los campos antiguos de Apps Script `driveFolderUrl`, `driveFolderName` y `syncFolderInfo` pertenecen al servicio anterior: no son sugerencias de espejo ni se vinculan automáticamente; solo aparecen como detalle administrativo. Si existe `.armi-sync-root.json`, debe corresponder al docente autenticado.

Login mantiene `skipDrivePreparation=true` y no crea carpetas. Subir a GitHub no actualiza Apps Script: conservar su despliegue y URL `/exec` al actualizarlo.

Picker inicia en Mi unidad con LIST y `setParent('root')`; la búsqueda puede mostrar otras ubicaciones. Esto no sustituye los controles del servidor. La selección se guarda desde la ventana aislada antes de cerrarla; se comprueban docente, revisión, origen, ventana y nonce. El retorno guarda IDs y metadatos en sessionStorage nativo temporal de un solo uso, sin tokens. No repetir escrituras automáticamente ante respuestas perdidas.

## Incidencias y pruebas

- Workers usa `redirect:'manual'` para rechazar redirecciones sin reenviar secretos. No usar `redirect:'error'`.
- ASSETS redirige `.html` con 307. Servir internamente `/drive-picker` con respuesta 200, manteniendo `/api/drive/picker?...` y su política de seguridad.
- OAuth y las cookies de Google del navegador son distintos: ARMI no puede iniciar sesión ni aceptar almacenamiento por el usuario. Edge móvil fue probado por el usuario; Brave móvil llegó a navegar solo a docs.google.com y requiere otra prueba real. No considerarlo resuelto sin esa prueba.
- Una lista vacía nunca significa borrado ni dispara cambios en Windows.
- Pruebas con proveedor simulado cubren alcance explícito, tokens antiguos, reconexión, descendientes, archivos externos, aislamiento, cifrado y revisión. Workerd valida el runtime, sin sustituir la prueba real ni la aprobación de Google.

Aceptación pendiente: configurar/aprobar el alcance en Google, reconectar, abrir subcarpetas, descargar una muestra y comprobar que un archivo añadido desde Windows aparece al actualizar. La sincronización de cambios académicos se desarrolla después; vincular una carpeta no la termina.

## Subidas nuevas y continuidad del trabajo

La transferencia usa un ID de archivo generado por Google y una preparación cifrada que caduca a los 30 minutos, asociada al docente, cuenta Google, raíz, carpeta destino y revisión de conexión. El servidor verifica tamaño y SHA-256 antes de enviar. Siempre crea archivos; nunca PATCH, nunca reemplazo de manifiestos o bases existentes. El mismo ID permite comprobar o repetir una transferencia sin crear otro archivo si se pierde la respuesta. No hay reintentos automáticos. La preparación y el File se conservan solo en memoria de la pestaña; cerrar/recargar pierde ese seguimiento y requiere comprobar manualmente el destino antes de empezar otra subida.

Se admiten hasta 20 preparaciones por hora y docente, con tamaño máximo de 5.000.000 bytes. Se usa multipart para archivos pequeños; los grandes necesitarán subidas reanudables. Las llamadas de subida se incluyen en las métricas de Drive. No se requiere SQL nuevo. El navegador y el servidor rechazan cambios de cuenta; el servidor revalida ascendencia y bloquea carpetas cuyo nombre empieza por .armi, incluida cualquier descendiente de .armi-sync. Las respuestas no incluyen tokens Google. Un nombre repetido no reemplaza otro archivo: Google puede mostrar ambos. Comprobar una subida reutiliza su preparación; comenzar otra genera un ID nuevo.

Los archivos estarán en la misma ubicación de Google Drive para escritorio cuando ese cliente los descargue. No implica que ARMI Windows incorpore automáticamente un adjunto a una sesión o evidencia: para ello falta registrar referencias y reconciliar el catálogo del espejo. El motor actual emplea incremental-v1, revisión de identidad 4, referencias portables, recibos y catálogos por dispositivo. La siguiente fase debe reutilizar ese contrato o añadir un puente controlado, sin sobrescribir database-dump.json, manifest.json ni los eventos existentes. Debe comparar una base común con los cambios web y escritorio y presentar conflictos antes de sustituir datos.

Al haber pasado de lectura a creación de archivos, actualizar la justificación y demostración de Google antes de una nueva presentación o cuando el revisor solicite aclaraciones: la descripción anterior de solo lectura ya no representa todas las funciones.
