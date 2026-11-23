# Enlaces por docente y entrada por DNI

El portal usa `/estudiantes/d45-profe-arnold`: `45` es el número del registro del docente en Google Sheets y `arnold` su usuario, no su nombre para mostrar. Dos docentes con nombres iguales reciben enlaces distintos. No se renumeran enlaces ya compartidos al ordenar la hoja.

## Activación en la instalación existente

1. En Cloudflare, abrir **D1 → armi-docente-web → Consola**. Ejecutar el contenido de `web/migrations/0010_teacher_portal_registry.sql`. Es aditivo y no borra datos. Se puede volver a ejecutar.
2. Abrir el proyecto de Apps Script que actualmente valida el inicio de sesión. Conservar su código y pegar al final las funciones completas de `web/scripts/apps-script-portal.gs`.
3. Buscar `function Login_(params)`. En su respuesta correcta, dentro del objeto `data`, agregar una propiedad junto a `username`. El resultado debe tener esta forma (conservar las demás propiedades):

   ```javascript
   return {
     success: true,
     data: {
       id: syncUserKey || rowUsername,
       username: rowUsername,
       portalIdentity: armiPortalTeacherIdentity_(sheet, rowIndex + 1, data, rowUsername),
       displayName: displayName,
       // Conservar aquí las demás propiedades existentes.
     }
   };
   ```

   Los nombres `sheet`, `rowIndex`, `data` y `rowUsername` corresponden a la función Login_ del script actual de ARMI. `data` en la llamada es la matriz de filas leída previamente por Login_, no el objeto de respuesta.
4. Guardar y actualizar **la implementación existente**: **Implementar → Administrar implementaciones → Editar (lápiz) → Nueva versión → Implementar**. Así se conserva la URL `/exec` configurada en Cloudflare. No crear otra implementación.
5. Cerrar sesión en ARMI Web e iniciar de nuevo. Ir a **Evaluación → Banco de Evidencias**, abrir el acceso y copiar el enlace que muestra ARMI. El estudiante entra con su DNI de ocho dígitos y contraseña, sin generar códigos. Para las contraseñas, activar también 0011 siguiendo [estas instrucciones](contrasenas-estudiantes.md).

En la primera asignación se añade `ARMI_DOCENTE_ID` después de las columnas existentes, como mínimo en la columna 29. Primera fila de datos = docente 1 (el encabezado no cuenta). Las filas sin usuario no reciben ID. Los números ya asignados se conservan; si una fila nueva ocupa una posición cuyo número ya existe, recibe uno libre. No modificar ni duplicar esa columna manualmente; al ordenar, incluirla con toda la fila.

Si falta la migración o el complemento de Apps Script, el login y los enlaces anteriores siguen funcionando. Banco de Evidencias muestra qué activación falta. Un número ya vinculado a otra cuenta nunca se reasigna automáticamente. No se inventan números tomando una posición del navegador ni el ID de sincronización.

## Comportamiento y verificaciones

- Abrir el portal permite entrar a estudiantes activos registrados con ese docente. No requiere habilitar uno por uno ni emitir códigos. La primera contraseña es el DNI; el estudiante debe crear una personal antes de consultar sesiones o enviar respuestas.
- El DNI debe estar completo y guardado como texto para conservar ceros iniciales. Si dos alumnos activos del mismo docente comparten DNI, corregir el registro antes de entrar. El mismo DNI puede pertenecer a registros de docentes diferentes sin mezclarlos.
- El docente puede bloquear o habilitar individualmente un estudiante desde el panel. Bloquearlo antes de su primer ingreso también se respeta.
- Cerrar el portal invalida las sesiones estudiantiles. Al reabrir, deben ingresar otra vez.
- Las publicaciones se filtran por docente, grado y sección. Cada alumno ve sus propias entregas, sin padrón, DNI ni notas de otros alumnos.
- Los enlaces aleatorios anteriores redirigen al enlace legible cuando existe. Sus identificadores también siguen siendo aceptados por los clientes anteriores.
- Las consultas del DNI tienen índices por docente/importación y toman en cuenta ediciones, bajas y eliminaciones. Los límites de intentos no guardan DNI en texto; no se añade sondeo periódico al panel.

Las pruebas automatizadas usan SQLite real para el aislamiento, acceso, cambios de DNI y compatibilidad; el complemento de Sheets se prueba con una hoja simulada sin modificar la hoja real.

## Escritorio y siguientes bloques

No se modifican código, base local, ejecutable ni túnel del escritorio. El complemento añade `data.portalIdentity.studentPortalUrl` a su respuesta de autenticación compartida. Ese campo permite que una actualización controlada del escritorio muestre **el mismo portal web** para la misma cuenta; todavía falta conectar el botón del escritorio y sincronizar sus datos. Este portal alojado en Cloudflare no depende de que la PC esté encendida.

Pendiente, en este orden:

1. Drive por docente: autorización de Google, elección de carpeta y subida, descarga y vista previa de evidencias.
2. Sincronización escritorio–web: registros y archivos, cambios identificados, detección de conflictos y actualización controlada del escritorio.
3. Asistencia, importación de Excel y herramientas de archivos que siguen bloqueadas en web.

No anunciar archivos ni sincronización como disponibles hasta completar y probar esos bloques. El botón de acceso actual solo abre/cierra el portal web.
