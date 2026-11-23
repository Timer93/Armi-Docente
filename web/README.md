# ARMI Docente en Cloudflare

La interfaz se compila directamente desde `../App.tsx`, `../components/` y los
estilos originales. No se mantiene una segunda colección de pantallas ni se
copia el código del escritorio. La entrada de web es `frontend/entry.tsx`;
`index.tsx`, Electron y la configuración de compilación del escritorio no cambian.

## Estado de esta publicación

- Acceso real con Google Sheets / Apps Script y sesión HttpOnly del Worker.
- Copias académicas por docente: datos generales, estudiantes, programaciones,
  unidades, sesiones y configuración de áreas/horarios. Importación explícita y
  consulta y guardado web de Datos generales, registro de Estudiantes,
  Programación Anual, Unidades y Sesiones. La
  sincronización bidireccional sigue pendiente.
- Menús y pantallas originales para revisar su compatibilidad en el navegador.
- Crear, editar y eliminar estudiantes; editar Datos generales. Protección contra
  sobrescrituras desde pestañas desactualizadas y avisos de guardado/error.
- Guardado y eliminación de planificaciones anuales, unidades y sesiones, con
  matrices y contenido estructurado. Se reutilizan las pantallas originales.
- Configuración de Áreas, Grados, Calendario, Feriados y Horario por cuenta,
  incluyendo colores del horario y las matrices/unidades fijadas de planificación.
- Los otros módulos siguen en consulta. Drive, IA, importación de Excel, fotos,
  operaciones masivas y portal de estudiantes web pendientes.
- No modifica ni sincroniza la base local. Una cuenta sin copia activa muestra
  campos vacíos; eso no elimina los registros del escritorio.

El encabezado avisa que la interfaz está en adaptación. Poder abrir un módulo
no demuestra que sus operaciones estén migradas. Esta no es todavía una versión
web completa para uso académico real.

## Aislamiento del escritorio

`scripts/build-original-ui.mjs` genera solo `web/dist/`. Durante la compilación
web resuelve el contexto de autenticación a `frontend/auth.tsx` y el cliente de
servicios a `frontend/desktop-api.ts`. Los servicios exclusivos de PC y los ciclos
de sincronización se sustituyen solo en este bundle por `desktop-only.tsx`.
Los archivos originales no se reescriben. El resultado de entradas utilizadas
queda localmente en `.web-build-inputs.json` y no se publica.

El botón de acceso de desarrollador y la opción de recordar credenciales del
login de escritorio se retiran del bundle web. La cuenta siempre se valida en
servidor; no se acepta una identidad de localStorage. Las sesiones vencen como
máximo a los 30 minutos o al vencimiento de la membresía, si es anterior.

`frontend/runtime.js` mantiene los borradores solo en memoria de esa página y
rechaza las operaciones todavía no migradas antes de enviarlas a Cloudflare o
localhost. Inicio y cierre de sesión recargan el contexto, para no reutilizar
caches entre docentes. Solo los campos de los módulos adaptados persisten en D1.

### Activar el guardado de Datos generales y Estudiantes

Después del despliegue, ejecutar `migrations/0004_academic_edits.sql` en la consola
de D1 de **armi-docente-web**, y recargar la página web. Es una tabla adicional:
no borra ni modifica las copias importadas, las cuentas ni el escritorio. Si la
tabla falta, se conserva el modo de consulta y el servidor rechaza escrituras.

Las modificaciones web se guardan en `academic_edits`, separadas por docente,
dataset e identificador, con revisión por registro y eliminaciones lógicas.
El cliente envía únicamente los campos modificados y serializa las operaciones
del mismo registro; el servidor rechaza revisiones y copias desactualizadas.
No se transmiten claves de IA, contraseñas estudiantiles, imágenes ni rutas de PC.
Una cuenta nueva puede crear datos sin importar un archivo de escritorio.
Los catálogos geográficos todavía solo ofrecen los valores de la copia importada.

Después de guardar cambios web, no se permite otra importación que los reemplace.
No hay todavía sincronización con el escritorio ni fusión automática. Ante un
error de guardado o conflicto, los siguientes guardados requieren recargar para
evitar sobrescribir registros con un formulario desactualizado. Conservar el
texto pendiente antes de recargar si se necesita recuperarlo.

### Activar el guardado de planificación

Ejecutar `migrations/0005_planning_edits.sql` en la consola de D1 de
**armi-docente-web** y recargar la aplicación. Solo añade `planning_edits`;
conserva las tablas existentes y las copias importadas. No requiere repetir la
importación. Mientras falte la tabla, estos módulos continúan en consulta; el
servidor rechaza sus escrituras y los módulos previamente habilitados siguen
funcionando. La tabla 0004 sigue siendo necesaria para Datos generales y alumnos.

- Cada registro conserva cuenta, dataset, identidad compuesta y revisión.
  Cambiar el año/área/grado/sección dentro de un identificador diferente se rechaza.
- La eliminación deja una marca. Una pestaña antigua no puede revivirla con un
  guardado atrasado. Para reutilizar el mismo número, se requiere la revisión de
  esa marca y una confirmación explícita de recreación.
- Se conservan los campos anidados, matrices y los descriptores textuales
  C/B/A/AD de las rúbricas. Los descriptores biométricos continúan excluidos.
- Las unidades se reflejan al reabrir una sesión mediante la función pura
  original `mergeUnitSessionPlanning`; no hay actualización en vivo de pestañas
  abiertas, ni una reescritura masiva de sesiones, ni sincronización con PC.
- IA, calificación, plantillas Word, archivos, recursos visuales y Drive siguen
  pendientes. Sus controles se bloquean en la compilación web y el transporte
  rechaza los servicios no migrados. Los catálogos de áreas/grados, calendarios
  y horarios propios se pueden configurar en web después de aplicar 0006, o
  recuperar desde una copia. Una cuenta nueva necesita completar estas piezas
  antes de elaborar planificación completa.

`public/curriculum.json` contiene únicamente columnas explícitas del catálogo
curricular compartido de ARMI: áreas, competencias y estándares. No contiene
cuentas, datos de docentes, alumnos ni desempeños personalizados. Se carga como
archivo estático una vez por página; no consulta D1 para cada selección de área.
`scripts/export-public-curriculum.mjs --database <ruta>` permite actualizarlo desde
una base de catálogo revisada, en modo de solo lectura; no se ejecuta en despliegue.

### Activar Áreas, Grados, Calendario y Horario

Ejecutar `migrations/0006_web_configuration.sql` en la consola D1 de
**armi-docente-web** y recargar la aplicación. Añade solo `web_configurations`;
conserva copias importadas, planes, estudiantes y las modificaciones previas.
No requiere volver a importar ni modificar el escritorio. Si falta la tabla,
estos apartados permanecen en consulta y los demás módulos siguen funcionando.

Se reutilizan las pantallas originales y su almacenamiento, reemplazado en web
por memoria de la página. El observador web escucha únicamente las nueve claves
académicas admitidas, agrupa cambios durante 500 ms y envía solo diferencias.
Nunca publica la sesión, credenciales, preferencias privadas u otras claves.
Áreas y asignaciones se guardan al editarlas; Calendario y Horario conservan sus
botones de guardar. La confirmación de progreso espera el guardado real del lote.

El servidor guarda una configuración con revisión por docente y combina sus
valores con los de la copia original. Cada lote es atómico: las áreas, asignaciones,
calendario u horario de otra pestaña no se reemplazan parcialmente cuando hay un
conflicto. Las eliminaciones se registran para no reaparecer desde la copia.
No hay sondeo periódico ni escrituras cuando los valores no cambiaron. Un error
de guardado detiene los reintentos automáticos y mantiene el aviso visible;
conservar cualquier borrador necesario antes de recargar para resolverlo.

La carga inicial debe completarse antes de observar ediciones; si falla la
lectura, se muestra el estado de recuperación en lugar de interpretar que la
cuenta está vacía. Una cuenta nueva puede configurar estos apartados sin importar
una base de escritorio. El catálogo nacional de instituciones/ubicaciones sigue
pendiente y conserva la limitación indicada en Datos generales.

## Desarrollo y comprobación

Desde `web/`:

```powershell
npm ci
Copy-Item .dev.vars.example .dev.vars
# Completar el secreto de autenticación sin subirlo a GitHub.
npm run db:local
npm test
npm run check:deploy
npm run dev
```

Wrangler ejecuta `npm run build` antes de compilar el Worker. La carpeta de
assets publicada es `dist/`, no `public/`. No ejecutar npm install ni compilar
Electron para publicar esta versión. El build web define las claves de IA como
vacías y no lee el archivo .env del escritorio.

## Publicación

- Repositorio: Timer93/Armi-Docente, rama `main`.
- Directorio raíz en Cloudflare Builds: `web`.
- Comando de comprobación: `npm test`.
- Comando de despliegue: `npx wrangler deploy`.
- Worker y base D1: `armi-docente-web`.
- Dominio personalizado: `web.armiapp.com`.
- El hostname workers.dev está deshabilitado en la configuración.

Los pushes a main disparan el proceso conectado de Cloudflare. Solo una
compilación y un despliegue exitosos actualizan la web. No actualizan el EXE.
La base del portal estudiantil y su túnel permanecen separados.

## Autenticación y recuperación

Configurar `ARMI_AUTH_APPS_SCRIPT_URL` como secreto de runtime en producción,
con la URL /exec de autenticación. Nunca incluir su valor en GitHub ni en los
archivos públicos. Ver [mantenimiento y recuperación](docs/autenticacion-apps-script.md).

La base necesita `0001_identity.sql` para cuentas, sesiones y controles de acceso.
La migración `0002_responsables.sql` pertenece a la interfaz parcial anterior:
se conserva como historial y para no borrar datos existentes. La interfaz
original de esta publicación no la necesita ni usa ese formulario separado.

## Primera copia académica por cuenta

1. Ejecutar una vez `migrations/0003_academic_snapshots.sql` en la consola de la
   base D1 existente. Es aditiva y usa `CREATE TABLE IF NOT EXISTS`.
2. En la computadora del docente ejecutar desde el repositorio:
   `node web/scripts/export-academic.mjs --owner USUARIO_DE_ARMI`.
   El origen predeterminado es `%APPDATA%/ARMI Docente/database/armi.db`; también
   admite `--database RUTA`. Se abre con SQLite en modo solo lectura y una
   transacción de lectura consistente. No se importa el módulo backend/db.js.
3. El archivo queda en `%LOCALAPPDATA%/ARMI/web-import/`, fuera de GitHub y de los
   assets públicos. Contiene datos personales académicos: compartirlo únicamente
   con el titular y cargarlo en su propia sesión web.
4. En la web, abrir **Importar copia**, seleccionar el archivo, revisar cuenta y
   cantidades y pulsar **Importar a mi cuenta**.

El exportador excluye contraseñas de estudiantes, claves de IA, tokens, rutas de
Windows, fotos y archivos incrustados. No exporta asistencia biométrica ni el
control de acceso. Los textos con HTML se depuran antes de mostrarse en web.
Esta copia aún no incluye los registros de evaluación, mensajes ni evidencias.

El servidor deriva `teacher_id` exclusivamente de la sesión; todas las claves,
consultas y relaciones de importación incluyen ese identificador. Los IDs locales
iguales de dos docentes no colisionan. No se crean tablas por docente.

Los lotes se registran con huella para poder reintentarlos con el mismo archivo.
Ningún registro se consulta hasta que sus cantidades se verifican y se activa la
copia completa. El cambio de copia activa comprueba una revisión: una importación
concurrente no reemplaza silenciosamente a otra. Las copias anteriores se retienen.
Los límites iniciales son 20 MB, 10.000 registros y cinco copias por cuenta; son
límites de esta implementación de prueba, no límites comerciales de membresía.
No hay limpieza automática de copias ni sincronización periódica.

Las lecturas se paginan con el índice `(teacher_id, import_id, dataset, record_id)`
y la interfaz comparte consultas pendientes y caches por cuenta durante esa página.
El inicio/cierre de sesión y la activación de una copia recargan el contexto.

## Monitoreo

El Worker mantiene mediciones de sus APIs mediante Analytics Engine
(dataset `armi_web_usage`, binding `USAGE_ANALYTICS`). El administrador autorizado
por `ARMI_ADMIN_USERNAMES` puede consultar `/api/admin/usage` con una sesión válida
si está configurado el secreto `ARMI_ANALYTICS_READ_TOKEN` con permiso de lectura.
La pantalla del administrador de escritorio todavía no se conecta a ese informe.
Las mediciones son estimadas, no una factura ni un límite automático de gasto.
El panel oficial de Cloudflare sigue siendo la referencia del consumo total.

## Pendientes acordados: transferencia, sincronización y acceso de estudiantes

### Exportación accesible desde el aplicativo

El importador web ya acepta la copia académica y existe el exportador externo
`scripts/export-academic.mjs`. Todavía no hay un botón dentro del EXE que genere
este formato. La opción de exportar Excel de Administrador es otra herramienta
y no genera el archivo que necesita el importador web.

Pendiente para una actualización posterior del escritorio: añadir **Exportar para
ARMI Web**. Debe tomar la cuenta actual, preparar una copia consistente de lectura,
excluir credenciales y archivos privados y permitir elegir dónde guardarla. El
docente no deberá instalar Node ni escribir comandos. Esta integración requiere
una actualización controlada del escritorio; no se realiza durante los cambios
actuales, que están restringidos a web.

Los usuarios que empiecen directamente en web no necesitarán importar una base
local cuando estén habilitados sus módulos de creación y guardado. Para usuarios
existentes, la primera transferencia pertenece a cada cuenta; la copia que se
preparó para desarrollo no migra automáticamente a los demás docentes.

### Primera transferencia y sincronización automática

Registrar como trabajo pendiente, no como función disponible:

- Facilitar la primera transferencia mediante la exportación integrada y, más
  adelante, una opción de conexión directa entre la cuenta del escritorio y web.
- Sincronizar cambios por usuario y registro, conservando los identificadores y
  comprobando revisiones. Registrar eliminaciones y detectar conflictos entre
  ediciones del escritorio y la web antes de reemplazar información.
- Mantener recuperación y reintentos sin duplicar registros; probar dos equipos
  de una cuenta, dos docentes distintos, trabajo sin conexión y reconexión.
- Medir consultas, escrituras y almacenamiento. Evitar reemplazar periódicamente
  el archivo SQLite completo y consultar el servidor por cada tecla.

La importación actual activa una copia completa. No observa la base local ni
propaga cambios posteriores en ninguna dirección. Debe seguir indicándose así.

### Interruptor del portal de estudiantes en web

Requisito solicitado: al adaptar el área de compartir acceso del Banco de
Evidencias, reemplazar los controles de cloudflared del escritorio por un
interruptor visual de **Acceso de estudiantes**, con estados **Abierto** y
**Cerrado**. La versión web alojada en Cloudflare no necesita un túnel de la PC.
El interruptor controla el portal del docente; no apaga la aplicación web ni
afecta a los demás docentes.

Condiciones para implementarlo:

- Persistir el estado por docente en D1, con valor inicial cerrado. Conservarlo
  al recargar o cerrar sesión hasta que el docente lo cambie.
- Solo la sesión autorizada del titular podrá cambiarlo. El servidor debe
  verificar el estado y los permisos del estudiante en cada operación del portal,
  incluyendo lecturas, envíos y la confirmación de archivos en curso.
- Un enlace conocido o una sesión previa del estudiante no deben eludir el cierre.
  Cerrar el acceso no borra datos, evidencias ni apaga el portal de otra cuenta.
- Mostrar texto además del color, foco visible y control accesible `role=switch`
  con `aria-checked`. Durante la petición, desactivar el interruptor; si falla,
  conservar el último estado confirmado y mostrar el error sin simular éxito.
- Respetar membresía y permisos sin consultar Apps Script por cada clic. Medir
  las operaciones del portal y evitar consultas periódicas innecesarias.
- No presentar el interruptor como operativo hasta conectar y probar el portal
  estudiantil web y sus comprobaciones en servidor. No reutilizar ni distribuir
  el token del túnel del escritorio para esta función.

Mientras se usa una copia de consulta, los indicadores de guardado de la
compilación web deben describir ese estado. La interfaz de escritorio conserva
sus textos y su funcionamiento actual.
