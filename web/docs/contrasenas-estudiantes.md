# Acceso de estudiantes con DNI y contraseña

La web reutiliza el formulario de Windows con DNI y contraseña, y su formulario de cambio inicial. No se acepta el acceso solo con DNI ni por los códigos antiguos.

## Activación

En **Cloudflare → D1 → armi-docente-web → Consola**, ejecutar el contenido de `migrations/0011_student_passwords.sql`. Son dos sentencias `CREATE TABLE IF NOT EXISTS`, sin comentarios, para poder pegarlas juntas o ejecutarlas separadamente. No borra registros y puede repetirse. No requiere cambiar Apps Script ni volver a importar datos.

Después recargar el enlace del estudiante con Ctrl+F5. Sin esas tablas el servidor rechaza los accesos y muestra la migración pendiente; no vuelve al ingreso sin contraseña. Las sesiones anteriores al cambio deben iniciar sesión otra vez.

## Flujo

1. El docente abre el portal y publica sus sesiones. El alumno debe estar activo con un DNI de ocho dígitos, sin duplicados en la cuenta del docente.
2. Primer acceso en web: DNI como usuario y DNI como contraseña inicial.
3. ARMI exige crear una contraseña de 8 a 128 caracteres, con letras y números y diferente del DNI. Antes de hacerlo, la sesión solo permite consultar su estado, cambiar la contraseña o cerrar sesión; no permite leer clases ni enviar entregas.
4. En los siguientes ingresos se usa el DNI y la contraseña personal. También puede cambiarse desde el espacio del estudiante. Cambiarla invalida las otras sesiones y los formularios antiguos.

Las contraseñas se guardan como hashes PBKDF2-SHA256 con sal aleatoria por contraseña, usando Web Crypto nativo (100000 iteraciones). No se guarda ni devuelve el texto de la contraseña ni se añade recuperación reversible. La compatibilidad del algoritmo está documentada en [Cloudflare Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/). Los intentos de ingreso y cambios de contraseña están limitados; no hay sondeo periódico nuevo.

Las claves pertenecen al registro estudiante/docente de D1. Los cambios comprueban en la escritura final el portal abierto, el acceso individual, la vigencia de la sesión y la revisión de la contraseña. Las entregas comprueban además que la sesión ya creó su contraseña y que su revisión sigue vigente.

## Relación con Windows

Se reproduce el flujo de acceso de Windows, pero **las contraseñas personales guardadas en Windows aún no están sincronizadas**. La importación académica excluye hashes, contraseñas y credenciales. Por eso el primer acceso en web usa la contraseña inicial DNI y crea una contraseña para web; no reemplaza la clave local de Windows. Compartir esa contraseña entre plataformas requiere la futura actualización controlada de sincronización. No afirmar que las contraseñas locales existentes ya se transfirieron.

La pantalla web y el adaptador se publican desde `web/`. No se modifica la autenticación ni el código del escritorio.
