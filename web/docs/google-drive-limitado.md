# Google Drive por docente: conexión limitada

## Estado real

Esta entrega conecta la cuenta del docente con Google OAuth, permite elegir una carpeta con Google Picker, autorizar archivos existentes y consultarlos, descargar binarios o previsualizar imágenes y PDF. No reemplaza el login de Google Sheets / Apps Script, no modifica Windows ni habilita todavía subida de evidencias o sincronización académica bidireccional.

El código solicita `drive.file openid email`. Rechaza autorizaciones que incluyan los permisos amplios `drive` o `drive.readonly`; no amplía el permiso automáticamente. El alcance limitado permite gestionar archivos autorizados por el usuario, pero esta entrega de ARMI solo realiza lecturas de Drive. La web continúa guardando datos académicos en D1 hasta desarrollar y validar la reconciliación de cambios.

Elegir una carpeta **no demuestra que todos sus archivos estén autorizados**. La lista solo muestra los archivos que Google devuelve para ARMI. El docente puede pulsar **Autorizar archivos o carpetas existentes**. Una lista vacía no se interpreta como eliminación, no se escribe en Windows y no permite activar una importación automática. Los archivos nuevos creados fuera de ARMI también deben comprobarse; no anunciar sincronización completa por seleccionar la carpeta.

El panel separa **Cuenta → Carpeta → Archivos**. Si Apps Script devuelve un enlace válido de carpeta para la cuenta autenticada, aparece como sugerencia; no hay un enlace fijo para un docente concreto, ni se escanea todo su Drive por nombre. La carpeta solo queda vinculada al seleccionarla y pasar las comprobaciones del servidor. Si no existe sugerencia, el usuario puede elegir una carpeta con Google Picker. Si falta su configuración, **Detalle para el administrador** identifica la clave o el número de proyecto que hay que revisar, sin mostrar valores secretos. Se eliminan espacios al principio o final de estos dos valores y se comprueba que el número de proyecto corresponda al prefijo numérico del cliente OAuth.

## Configuración administrativa, una vez para ARMI

1. Crear un proyecto llamado **ARMI Docente** en [Google Cloud](https://console.cloud.google.com/projectcreate), sin vincular cuenta de facturación ni contratar la prueba de pago. La facturación no es un paso de este procedimiento.
2. En el mismo proyecto habilitar **Google Drive API** y **Google Picker API**.
3. En **Google Auth Platform**, configurar la marca ARMI, correo de soporte y audiencia **External**. Privacidad pública: `https://web.armiapp.com/privacidad`; condiciones: `https://web.armiapp.com/condiciones`. Comprobar que ambos enlaces carguen sin sesión antes de guardarlos en Google. Para la prueba inicial, añadir la cuenta Google del docente como usuario de prueba. Añadir únicamente `drive.file` y los permisos básicos de identidad `openid`, `email`. Para el acceso de docentes externos, completar la marca y publicar la aplicación desde **Público**; atender los requisitos de verificación que indique Google. Publicar OAuth no habilita funciones pendientes de ARMI ni activa facturación por sí mismo.
4. Crear un cliente OAuth de tipo **Aplicación web**, con nombre **ARMI Web**. Origen autorizado: `https://web.armiapp.com`. URI de redirección exacta:

   ```text
   https://web.armiapp.com/api/drive/oauth/callback
   ```

5. Crear la clave de API para Google Picker. Restringirla a sitios web `https://web.armiapp.com/*` y `https://docs.google.com/*`, y a **Google Picker API**. El número de proyecto usado en Picker debe ser del mismo proyecto del cliente OAuth. El navegador no hace llamadas directas a Drive API fuera de Picker.
6. En **Cloudflare → D1 → armi-docente-web → Consola**, ejecutar `migrations/0012_drive_connection.sql`. Es aditivo y repetible; no borra las tablas existentes ni modifica la base local.
7. En las variables y secretos de runtime de **armi-docente-web / Producción**, guardar estos valores como **Secretos** para conservarlos entre publicaciones de Wrangler. No subir valores reales a GitHub ni pegarlos en una conversación:

   | Nombre | Valor |
   |---|---|
   | `ARMI_GOOGLE_CLIENT_ID` | ID del cliente web, terminado en `.apps.googleusercontent.com` |
   | `ARMI_GOOGLE_CLIENT_SECRET` | Secreto del cliente OAuth web |
   | `ARMI_GOOGLE_PROJECT_NUMBER` | Número del proyecto, solo dígitos; no su nombre ni ID alfanumérico |
   | `ARMI_GOOGLE_PICKER_API_KEY` | Clave de Google Picker con restricciones |
   | `ARMI_DRIVE_ENCRYPTION_KEY` | Clave aleatoria de cifrado de 32 bytes, representada con 64 caracteres hexadecimales |

   La clave de Picker y el ID de cliente son identificadores que Google utiliza en el navegador, no contraseñas de la cuenta. Se almacenan aquí para mantener la configuración fuera de GitHub. La clave de Picker se entrega únicamente al selector del docente autenticado. El secreto OAuth y la clave de cifrado nunca se envían al navegador.

   Para crear la clave de cifrado en PowerShell desde la carpeta del proyecto:

   ```powershell
   node web/scripts/create-drive-encryption-key.mjs | Set-Clipboard
   ```

   Pegar en Cloudflare sin imprimirla ni compartirla. Conservarla: reemplazarla impedirá abrir conexiones ya guardadas y exigirá reconectar las cuentas.
8. Guardar/implementar los secretos, entrar a ARMI Web y abrir **Google Drive**. Conectar la cuenta personal del docente y elegir su carpeta real del espejo con el selector de Google. Si Apps Script informa una carpeta, se ofrece como sugerencia; no se confía en una ruta `G:\...` o en el nombre del docente para elegirla.

Si falta configuración, el panel lo indica y mantiene disponible el resto de ARMI. No hace falta modificar la URL de Apps Script. Windows continúa usando su espejo actual.

## Prueba de aceptación con una carpeta real

- Confirmar que el correo conectado es la cuenta que contiene o puede acceder a la carpeta.
- Seleccionar esa carpeta y autorizar una imagen, un PDF y, si existe, `.armi-sync-root.json` de su raíz. El servidor compara `syncUserKey` del marcador con la identidad confiable recibida de Apps Script. Una identidad de otro docente se rechaza.
- Abrir la lista y descargar los mismos archivos; comparar sus contenidos con Windows. Verificar que los archivos no autorizados no se describen como borrados.
- Comprobar un archivo creado desde Windows después de la selección inicial: medir si Google lo concede o exige seleccionarlo de nuevo. Este resultado determina qué adaptación será necesaria para la sincronización automática.
- Intentar abrir desde ARMI un archivo externo a la carpeta: se debe rechazar aunque esa cuenta Google pueda leerlo.
- Desvincular y comprobar que cesa el acceso desde ARMI sin borrar archivos de Drive.

Hasta completar esta prueba con Google real, la conexión está preparada y probada con proveedor simulado, pero no se considera validada para el espejo del usuario. Los documentos nativos de Google no tienen exportación conectada en esta entrega; los binarios descargables están limitados a 100 MB.

## Seguridad y consumo

- Las solicitudes de Google usan `redirect: 'manual'` y rechazan respuestas que no sean exitosas. No utilizar `redirect: 'error'`: Workers no implementa ese modo y falla antes de enviar la solicitud. `test/drive-runtime.test.mjs` ejecuta el flujo de autorización y lectura en workerd con Google simulado y comprueba que no se sigan redirecciones con credenciales. La misma comprobación cubre las llamadas de IA; no consume claves reales ni reemplaza la prueba de Drive con una cuenta real.
- El HTML del selector se sirve internamente desde el recurso canónico `/drive-picker`, con una respuesta 200 en `/api/drive/picker?mode=…&requestId=…`. No pedir `/drive-picker.html` al binding ASSETS: genera una redirección 307 que puede sacar la ventana de la ruta autenticada, perder los parámetros y aplicar la política de scripts de la página principal. La prueba de workerd incluye el binding real de recursos estáticos y comprueba que la ruta protegida no redirige y conserva su política de seguridad específica. No quitar la comprobación de ventana de origen y nonce para ocultar ese error.
- La ventana solo muestra un indicador de carga, que se oculta cuando se abre el selector de Google. Si falla la preparación, detiene el indicador y ofrece reintentar o consultar ayuda; no vuelve a iniciar OAuth automáticamente. La interfaz de Google se solicita en español. Sus avisos de sesión y cookies pertenecen al contenido de Google: la autorización guardada en ARMI no demuestra que el navegador permita esa sesión incrustada. El panel ofrece instrucciones para abrir Drive en el mismo navegador, permitir las cookies solicitadas para ese contexto y consultar la ayuda oficial de Edge; no se fuerza una aceptación ni se solicita acceso general a todo Drive. La prueba del cliente comprueba la transición de carga, errores/tiempos de espera y la devolución segura de IDs, pero no simula una aceptación real de cookies del usuario.

- OAuth usa PKCE, estado de un solo uso con caducidad y vínculo a la sesión y al docente. Los tokens persistentes se cifran con AES-GCM y datos asociados de la cuenta. Se comprueba la revisión al reconectar o desvincular.
- El selector vive en `/api/drive/picker`, separado de la interfaz principal. Solo esa página permite cargar los scripts/iframes de Google. Recibe un token de acceso breve en memoria para Picker, nunca el token de renovación. La ventana principal verifica origen, ventana y nonce antes de aceptar la selección, y el servidor vuelve a comprobar la carpeta.
- Solo docentes autenticados acceden a estas rutas; no se entregan tokens de Google a estudiantes. Esta conexión no cambia la contraseña de ARMI ni la de Google.
- Las listas se paginan a 50 archivos, y el selector autoriza hasta 20 archivos por vez. Se reutilizan las comprobaciones de carpetas dentro del mismo lote y se limita a 40 llamadas de Drive por petición para conservar margen en Workers Free. No hay sondeo periódico ni reintentos automáticos. Se renueva el token únicamente cuando hace falta.
- El contador de administrador registra `driveCalls` y `driveUnitsEstimated` por docente en Analytics Engine, sin escribir un contador D1 por cada consulta. Son estimaciones de llamadas desde este Worker, no una factura: 5 unidades para metadatos, 100 para listas y 200 para descargas, según las referencias consultadas. No incluye uso externo del proyecto ni transferencias en bytes.
- En modo OAuth **Testing**, Google puede caducar el token de renovación a los 7 días para estos permisos. No prometer una conexión permanente hasta configurar la publicación y verificación necesarias para producción. No se habilita facturación para esa prueba.

Referencias: [Permisos de Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Google Picker](https://developers.google.com/workspace/drive/picker/guides/web-picker), [OAuth y caducidad de tokens](https://developers.google.com/identity/protocols/oauth2), [Cuotas de Drive](https://developers.google.com/workspace/drive/api/guides/limits).
# Continuación de conexión y carpeta por docente

Al conectar Google, ARMI vuelve al panel y continúa al selector en la misma pestaña si falta vincular una carpeta. Una carpeta ya vinculada se conserva al reconectar la misma cuenta de Google; cambiar de cuenta la desvincula. Cancelar el selector conserva la carpeta anterior. Para cambiar carpetas o autorizar archivos durante el trabajo, se conserva el selector en ventana aparte: no se recarga una pantalla con ediciones en curso.

La continuación usa únicamente un identificador de selección, cuenta ARMI, revisión, correo y los IDs elegidos en el sessionStorage nativo de esa pestaña (15 minutos, un solo uso). Se captura antes del almacenamiento en memoria de compatibilidad del escritorio. No contiene tokens de Google. Al regresar se comprueban docente, correo y revisión; el servidor vuelve a verificar los permisos y pertenencia de la carpeta.

El enlace y nombre sugeridos se reciben del acceso de Apps Script (`driveFolderUrl` / `driveFolderName`, o `syncFolderInfo.folderUrl` / `folderName`). No son permisos de Google. Si Apps Script no devuelve nombre, se indica pendiente hasta seleccionar y comprobar la carpeta. La carpeta vinculada muestra el nombre confirmado y su URL canónica, sin consultas periódicas adicionales a Drive. Un nombre guardado puede quedar desactualizado si se renombra desde Google; volver a seleccionar actualiza el nombre.

Google puede requerir sesión y autorización de cookies/almacenamiento en cada navegador, especialmente en móviles. El flujo no acepta permisos por el usuario ni garantiza suprimir las pantallas de Google. La sesión de la aplicación móvil de Drive no reemplaza la sesión del navegador.
