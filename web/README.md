# ARMI Docente en Cloudflare

La interfaz se compila directamente desde `../App.tsx`, `../components/` y los
estilos originales. No se mantiene una segunda colección de pantallas ni se
copia el código del escritorio. La entrada de web es `frontend/entry.tsx`;
`index.tsx`, Electron y la configuración de compilación del escritorio no cambian.

## Estado de esta publicación

- Acceso real con Google Sheets / Apps Script y sesión HttpOnly del Worker.
- Copias académicas por docente: datos generales, estudiantes, programaciones,
  unidades, sesiones y configuración de áreas/horarios. Importación explícita y
  consulta; el guardado académico y la sincronización bidireccional siguen pendientes.
- Menús y pantallas originales para revisar su compatibilidad en el navegador.
- Controles de edición del contenido deshabilitados mientras se adapta el servidor.
- Guardado académico, Drive, IA, importaciones y control de Windows pendientes.
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
caches entre docentes. No se ofrece persistencia académica en este modo.

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
