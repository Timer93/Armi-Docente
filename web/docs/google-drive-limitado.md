# Google Drive por docente: conexión limitada

## Estado real

Esta entrega conecta la cuenta del docente con Google OAuth, permite elegir una carpeta con Google Picker, autorizar archivos existentes y consultarlos, descargar binarios o previsualizar imágenes y PDF. No reemplaza el login de Google Sheets / Apps Script, no modifica Windows ni habilita todavía subida de evidencias o sincronización académica bidireccional.

El código solicita `drive.file openid email`. Rechaza autorizaciones que incluyan los permisos amplios `drive` o `drive.readonly`; no amplía el permiso automáticamente. El alcance limitado permite gestionar archivos autorizados por el usuario, pero esta entrega de ARMI solo realiza lecturas de Drive. La web continúa guardando datos académicos en D1 hasta desarrollar y validar la reconciliación de cambios.

Elegir una carpeta **no demuestra que todos sus archivos estén autorizados**. La lista solo muestra los archivos que Google devuelve para ARMI. El docente puede pulsar **Autorizar archivos o carpetas existentes**. Una lista vacía no se interpreta como eliminación, no se escribe en Windows y no permite activar una importación automática. Los archivos nuevos creados fuera de ARMI también deben comprobarse; no anunciar sincronización completa por seleccionar la carpeta.

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

- OAuth usa PKCE, estado de un solo uso con caducidad y vínculo a la sesión y al docente. Los tokens persistentes se cifran con AES-GCM y datos asociados de la cuenta. Se comprueba la revisión al reconectar o desvincular.
- El selector vive en `/api/drive/picker`, separado de la interfaz principal. Solo esa página permite cargar los scripts/iframes de Google. Recibe un token de acceso breve en memoria para Picker, nunca el token de renovación. La ventana principal verifica origen, ventana y nonce antes de aceptar la selección, y el servidor vuelve a comprobar la carpeta.
- Solo docentes autenticados acceden a estas rutas; no se entregan tokens de Google a estudiantes. Esta conexión no cambia la contraseña de ARMI ni la de Google.
- Las listas se paginan a 50 archivos, y el selector autoriza hasta 20 archivos por vez. Se reutilizan las comprobaciones de carpetas dentro del mismo lote y se limita a 40 llamadas de Drive por petición para conservar margen en Workers Free. No hay sondeo periódico ni reintentos automáticos. Se renueva el token únicamente cuando hace falta.
- El contador de administrador registra `driveCalls` y `driveUnitsEstimated` por docente en Analytics Engine, sin escribir un contador D1 por cada consulta. Son estimaciones de llamadas desde este Worker, no una factura: 5 unidades para metadatos, 100 para listas y 200 para descargas, según las referencias consultadas. No incluye uso externo del proyecto ni transferencias en bytes.
- En modo OAuth **Testing**, Google puede caducar el token de renovación a los 7 días para estos permisos. No prometer una conexión permanente hasta configurar la publicación y verificación necesarias para producción. No se habilita facturación para esa prueba.

Referencias: [Permisos de Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Google Picker](https://developers.google.com/workspace/drive/picker/guides/web-picker), [OAuth y caducidad de tokens](https://developers.google.com/identity/protocols/oauth2), [Cuotas de Drive](https://developers.google.com/workspace/drive/api/guides/limits).
