# Administrador y Control de acceso

También incluye **Agente de Windows · ARMI Estudiante**: instalador EXE, inscripción grupal, permisos por PC y órdenes de carpetas/archivos. Véase [agente-estudiante.md](agente-estudiante.md).

El menú «Administrar BD» pasa a llamarse «Administrador» y contiene:

- **Bases de Datos**: conserva las herramientas existentes de tablas, importación y edición.
- **Control de acceso**: registro de grupos y equipos, más reglas de dominios bloqueados para todos, un grupo o equipos seleccionados.

Las reglas se pueden editar, habilitar, deshabilitar y eliminar. El botón «Guardar cambios» persiste el borrador completo. Las URL se convierten a dominios; la futura extensión deberá incluir sus subdominios al aplicar cada regla.

## Estado de esta entrega

El panel administra la configuración y vincula la extensión ARMI Estudiantes 1.0.0. Cada equipo recibe un código de un solo uso que caduca en diez minutos. El panel distingue equipos sin vincular, conectados, desconectados, con reglas pendientes y con reglas aplicadas. También permite revocar la vinculación.

La extensión recibe únicamente la política efectiva de su equipo (unión de las reglas habilitadas para todos, su grupo y su identificador). Instala reglas nativas Manifest V3 y confirma la revisión y cantidad de dominios. Los equipos definidos manualmente disponen de identificadores UUID estables. La consulta es aproximadamente cada 30 segundos mientras el navegador está activo; también hay sincronización manual.

## Persistencia y API

`GET /api/admin/access-control` devuelve configuración, revisión y fecha de guardado. `PUT` recibe `{config, revision}`. Una revisión desactualizada devuelve HTTP 409 y conserva los datos actuales.

Se guarda una sola fila `armi_access_control_v1` en `armi_frontend_state`, aprovechando la sincronización existente. No se agregan tablas académicas ni se modifican notas o recursos. Abrir el panel vacío no escribe valores predeterminados en la base.

La API de administración solo admite la PC docente, el puerto docente y orígenes locales. Rechaza el puerto estudiantil, Cloudflare y conexiones reenviadas desde direcciones externas. Se admite el proxy local de Vite.

La extensión usa `POST /api/access-extension/pair`, `GET /api/access-extension/policy` y `POST /api/access-extension/ack`, disponibles también en el puerto estudiantil. Las políticas y confirmaciones requieren una credencial Bearer de 256 bits. Los códigos se limitan por origen de conexión, se consumen una sola vez y solo el docente puede emitirlos. El servidor conserva únicamente sus huellas y las de las credenciales.

Las credenciales, presencia y revisiones aplicadas se guardan en `sync-runtime/access-extension.sqlite`, separado de la base académica y de la sincronización con Drive. Sus avisos no solicitan pasadas de sincronización académica. **Este archivo es configuración activa del sistema, no una copia descartable.** Si falla este registro, el resto de ARMI puede iniciar y la extensión conserva las últimas reglas.

## Verificación

- `npm run typecheck`: aprobado.
- `npm run build`: aprobado; muestra advertencias existentes por tamaño de bundles y una clave duplicada en package.json.
- `npm run test:access-control`: persistencia, referencias de grupos y equipos, normalización de dominios, tres alcances, control de revisiones y restricciones de acceso.
- `npm run test:access-control-ui`: interfaz React en Electron aislado; navegación entre las dos secciones, creación de grupo y equipo, guardado de regla grupal y su edición a individual, recuperación al recargar y anchuras de 1600 y 800 píxeles sin desbordamiento horizontal.

Las pruebas utilizan SQLite en memoria y un perfil de navegador de prueba. No acceden a los datos reales de ARMI. Capturas: `artifacts/access-control-ui/access-1600.png` y `access-800.png`.

## Instalar la extensión

`npm run package:student-extension` genera `public/extensions/ARMI-Estudiantes.zip`; `npm run build` también lo genera y lo copia a `dist/extensions/`. El panel docente ofrece ese archivo con «Descargar extensión».

El ZIP incluye la extensión, `Instalar.ps1`, las huellas de sus archivos y un manual HTML. Puede distribuirse por USB o red. El instalador copia los archivos a `%LOCALAPPDATA%\ARMI Estudiantes\extension` y verifica sus huellas, sin permisos de administrador. La carga se confirma en `chrome://extensions` o `edge://extensions`: Modo de desarrollador → Cargar descomprimida. La distribución automática desde tiendas o políticas institucionales queda fuera de este paquete local.

En ARMI: registrar y guardar el equipo → Generar código. En el navegador estudiantil: abrir ARMI Estudiantes → introducir dirección y código → permitir la conexión a esa dirección. La dirección LAN normalmente utiliza el puerto 3001. ARMI y la red deben estar disponibles para recibir cambios; sin conexión siguen vigentes las últimas reglas. HTTP se admite para direcciones IP privadas; una dirección de Internet requiere HTTPS.

La carpeta de la extensión instalada es un componente activo y no debe borrarse al limpiar el ZIP o la carpeta extraída. El docente administra el navegador/perfil vinculado, no otras aplicaciones o perfiles. En instalaciones locales el usuario puede desactivar la extensión; impedirlo requiere gestión institucional. Chrome/Edge 121 o posteriores son necesarios. Las pruebas reales se realizaron en Microsoft Edge.

La extensión consulta las URL de las pestañas abiertas localmente para recargar solo las afectadas por un bloqueo nuevo. No transmite esas URL, historial, contraseñas, páginas ni notas. El permiso de pestañas permite esa actualización de sitios ya abiertos. Los mensajes salientes contienen identificación del equipo, versión y confirmación de reglas.

Los cambios del docente están en el proyecto y la compilación web. Esta entrega no reemplaza automáticamente la aplicación instalada ni publica en tiendas. El servidor ARMI debe actualizarse/reiniciarse con este código para ofrecer los endpoints nuevos; la versión instalada anterior no puede vincular la extensión.

## Pruebas adicionales de la extensión

- `npm run test:student-extension`: códigos caducados/reutilizados, credenciales hash, reglas individuales/grupales/globales, actualización HTTP, revisiones, presencia separada, desconexión, aplicación fallida y revocación. Comprueba que solo se recargan las pestañas afectadas y que las consultas no generan escrituras académicas.
- `npm run test:student-extension-browser`: navegador Edge real en perfil aislado; popup y service worker reales, bloqueo nativo de páginas y subdominios, sitios permitidos, desbloqueo al cambiar reglas, pestaña previamente abierta, conservación sin ARMI y tras reiniciar el navegador, revocación. El perfil de prueba preconcede acceso solamente a localhost para evitar un diálogo interactivo de permisos; el paquete distribuido solicita el origen docente al vincular.
- `npm run test:student-extension-server`: arranque de ARMI completo con una base vacía aislada, descarga del ZIP, vinculación por el puerto estudiantil, bloqueo de rutas administrativas en ese puerto y confirmación de que el tráfico de la extensión no incrementa el reloj de sincronización académico.
- El ZIP se revisa por integridad, rutas y SHA-256 de todos sus archivos de extensión. El instalador PowerShell se comprueba sintácticamente y no se ejecuta sobre el perfil real del docente durante las pruebas.

Fuentes oficiales: [reglas declarativas de Chrome](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest), [permisos de conexión](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), [alarmas](https://developer.chrome.com/docs/extensions/reference/api/alarms), [instalación local en Edge](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading), [restricciones de distribución en Chrome](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions).
