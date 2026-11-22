# ARMI Web — primer módulo

Aplicación independiente para Cloudflare Workers + D1. Conserva Google Sheets y
Apps Script como proveedor de cuentas y membresías. Incluye inicio/cierre de
sesión, edición del perfil propio y monitoreo de consumo para administrador.
No conecta ni modifica la base del escritorio.

Datos generales → Responsables reutiliza `components/shared/ResponsablesSection.tsx`,
el mismo componente que importa `components/DatosGeneralesView.tsx` en escritorio.
La web guarda sus cinco campos por docente con sesión HttpOnly y control de
revisión para evitar sobreescribir una edición concurrente. El guardado es
explícito, sin consultas periódicas ni escrituras por cada tecla.

Antes de usarlo en una base ya creada, ejecutar una sola vez
`migrations/0002_responsables.sql` en la consola de D1, o aplicar las migraciones
con Wrangler. Esta migración es aditiva: no importa datos del escritorio.
No existe sincronización automática entre ambos entornos todavía.

Esta entrega no incluye todavía cursos, notas, estudiantes, Drive, pagos ni
activación automática de pruebas de 30 días. Tampoco demuestra capacidad para
3.000 usuarios concurrentes. El siguiente módulo requiere autorización de cada
operación por docente antes de importar datos reales.

## Desarrollo local

Desde esta carpeta (no desde la raíz del aplicativo):

```powershell
npm ci
Copy-Item .dev.vars.example .dev.vars
# Editar .dev.vars con la URL /exec de tu despliegue de autenticación.
npm run db:local
npm run dev
```

Abrir `http://localhost:8787`. El modo local utiliza una cookie HttpOnly exclusiva
de localhost. La publicación HTTPS utiliza una cookie __Host- Secure, HttpOnly,
SameSite=Lax. No hay acceso de desarrollador ni cuentas ficticias en el servidor.
Las cuentas ficticias existen exclusivamente en los tests.

```powershell
npm test
npm run check:deploy
```

## Contrato de acceso existente

**Si cambia la URL de Apps Script o falla el inicio de sesión**, consultar la
[guía de mantenimiento y recuperación](docs/autenticacion-apps-script.md).

El Worker envía `action: Login`, usuario y contraseña al Apps Script mediante
HTTPS. `Placa` se envía vacía: el Login_ existente omite el registro de una nueva
PC en ese caso. La URL se configura en servidor, nunca en el JavaScript público.
No se almacena la contraseña. No se utiliza el token de Cloudflare Tunnel.

El proveedor debe responder `success: true` y `data.username` junto con un estado
habilitado (`estado` o `subscriptionStatus`). Se rechazan estados pendientes,
bloqueados, inactivos y vencimientos no válidos. Si hay fecha de vencimiento,
también limita la sesión. La identidad proviene exclusivamente de Apps Script.

Las sesiones duran como máximo 30 minutos y no se renuevan sin autenticación.
Durante ese plazo, las operaciones usan D1 y no consultan Sheets en cada clic.
Un bloqueo realizado en Sheets puede tardar hasta el vencimiento de esa sesión
en aplicarse en web. La revocación inmediata y renovación segura son tareas
posteriores. No se copian los permisos del navegador ni se confía en localStorage.

El perfil web se guarda aparte; por ahora, sus cambios no actualizan Sheets ni el
perfil del escritorio. Todas sus consultas y escrituras se filtran por el docente
de la sesión. No se acepta un ID de docente proporcionado por el navegador.

Se permiten 10 intentos de acceso por IP por minuto y un máximo global de 5
autenticaciones simultáneas. Los controles residen en D1, no en memoria de un
Worker. El límite global es conservador para la primera prueba, no una capacidad
de producción. No evita el consumo provocado por todo ataque distribuido; antes
del lanzamiento público se debe añadir protección contra bots y medir el proveedor.

## Publicación en la cuenta propia de Cloudflare

1. Trabajar con una rama/revisión que incluya únicamente los archivos aprobados.
   El repositorio principal puede contener otros cambios en curso.
2. Crear una base D1 de pruebas y añadir su `database_id` en `wrangler.jsonc`.
   Si se omite, Wrangler puede aprovisionarla al publicar: esto crea un recurso
   remoto. No ejecutar `deploy` hasta decidir la cuenta y la base de destino.
3. Configurar `ARMI_AUTH_APPS_SCRIPT_URL` como secreto del Worker. Para CLI:
   `npx wrangler secret put ARMI_AUTH_APPS_SCRIPT_URL`. No pasar valores en la
   línea de comandos ni guardarlos en GitHub.
4. Aplicar la migración con
   `npx wrangler d1 migrations apply DB --remote` y publicar la revisión probada.
5. En Workers & Pages, conectar GitHub, seleccionar el repositorio y configurar
   `web` como directorio raíz. Comando de despliegue: `npm run deploy`.
6. Probar dos cuentas reales independientes, cierre de sesión y vencimiento.
   No reutilizar datos de producción para las pruebas iniciales.
7. Solo después vincular `app.armiapp.com` como dominio del Worker. La
   configuración no incluye rutas ni cambios sobre `armiapp.com`, que sigue
   atendiendo al portal estudiantil actual mediante el túnel.

## Consumo y acceso del administrador

`ARMI_ADMIN_USERNAMES` está configurado como `Timer`, por indicación del propietario.
El usuario debe existir en Sheets y superar el acceso normal. El permiso se
verifica en cada consulta al panel, además de ocultar el botón a otros usuarios.
No se crea una cuenta nueva ni se establece una contraseña.

El binding `USAGE_ANALYTICS` escribe un punto en Analytics Engine por petición API.
No escribe contadores adicionales en D1. Registra el ID interno del docente, ruta
conocida, lecturas/escrituras reportadas por D1, número de sentencias, intentos de
autenticación contra Google, errores y duración transcurrida. Esa duración NO es
tiempo de CPU. No registra contraseñas, cookies, IP, query strings ni contenidos.
Los accesos sin sesión se agrupan como no atribuidos. Los eventos de una cuenta
no suman automáticamente las llamadas futuras de estudiantes: ese vínculo debe
añadirse cuando se migre el portal estudiantil.

Para consultar el panel se necesita un secreto `ARMI_ANALYTICS_READ_TOKEN` con el
permiso `Account > Account Analytics > Read`, restringido a la cuenta configurada.
El ID de cuenta no es una credencial. El token de lectura es un secreto del
servidor y jamás debe incluirse en `vars`, código público o GitHub.
Sin la conexión se muestra "falta conectar", no consumo cero.

La consulta es manual, con caché de 60 segundos por isolate, y puede seleccionar
un día UTC de los últimos 89 días. Se muestran totales y las 100 cuentas con más
actividad. Las referencias del plan Free (100.000 solicitudes, 5 millones de filas
leídas y 100.000 escritas por día) tienen indicadores al 70%, 85% y 95%; no bloquean
operaciones ni contratan servicios. No son una lectura oficial del saldo de cuota.

Analytics Engine puede muestrear los datos y tiene demora de ingestión. Los
totales ponderan `_sample_interval` y se identifican como estimaciones. Se excluyen
otros Workers, accesos externos a D1, mantenimiento programado, almacenamiento,
CPU y facturación. Los errores de consulta pueden no devolver metadatos de D1.
La fuente definitiva para cuotas de toda la cuenta es el panel de Cloudflare.
La retención documentada de Analytics Engine es de tres meses. Para tendencias
más largas se requerirán resúmenes periódicos, todavía no implementados.

Los estáticos se sirven directamente con sus cabeceras, sin ejecutar el Worker.
Solo `/api/*` pasa primero por el servidor. Las lecturas GET idénticas en curso
comparten una solicitud dentro de la página; no se reutilizan tras terminar ni
entre sesiones. Las escrituras no se agrupan ni se reintentan automáticamente.

## GitHub y actualización automática

Rama de publicación: `main`. El workflow `ARMI Web checks` instala
dependencias y ejecuta pruebas y empaquetado de comprobación, sin desplegar.
En Cloudflare Builds, el directorio raíz debe ser `web`, el nombre del Worker
`armi-docente-web` y la rama de producción `main`. Usar `npm test` como
comando de compilación/verificación y `npm run deploy` como comando de despliegue.
Solo entonces cada push a esa rama podrá disparar una publicación; si las pruebas
o la compilación fallan, el despliegue no debe continuar. Ajustar los build watch
paths para que cambios exclusivos de escritorio no generen builds innecesarios.

Esta rama sigue siendo un primer módulo. No habilitarla como plataforma completa
ni reemplazar el portal actual: faltan los módulos educativos y el acceso real a
Drive. La sincronización y las migraciones de esquema requieren un procedimiento
aparte; publicar código no las resuelve automáticamente.

Los archivos públicos se limitan a `public/`. La publicación no contiene el
backend de escritorio, bases locales, uploads ni secretos. La limpieza diaria
elimina sesiones, contadores y reservas de acceso vencidos.
