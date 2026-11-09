# Agente de aula ARMI Estudiante

## Versión vigente 1.2.0: instalador genérico

El EXE ya no incorpora ni lee `teacher.public.json`, el perfil de compilación o la identidad local del desarrollador. Sirve para cualquier docente/colegio. La detección UDP obtiene candidatos firmados; si hay más de uno, el agente permite elegir. Primero se aprueba la solicitud en ARMI, y para una identidad nueva se compara el código de ocho caracteres mostrado en ambos extremos y se confirma en el estudiante. El código vincula identidad pública, instalación y secreto de la solicitud. El instalador no confía por defecto en el primer servidor que responda.

Las identidades comprobadas se guardan con DPAPI en `known-teachers.dat`. Cada docente utiliza un secreto de solicitud independiente, preservado entre reintentos. Una desconexión solo busca la identidad ya vinculada: nunca cambia a un vecino automáticamente. «Cambiar de docente» desde la bandeja inicia la detección y verificación de otro docente sin reinstalar; conserva credenciales, materiales y últimas reglas del anterior hasta completar el nuevo vínculo. Durante el cambio se pausan las órdenes anteriores. «Cancelar» recupera la conexión anterior. Volver a un docente ya verificado todavía requiere aprobación docente, pero recuerda su identidad.

El nuevo protocolo de vinculación es `pairingProtocol: 3` en la API de inscripción. El docente muestra también las solicitudes aprobadas hasta que el estudiante confirma, para poder comparar el código. Los agentes vinculados antiguos conservan su conexión y las API previas siguen funcionando. La nueva vinculación requiere actualizar el backend y frontend docentes; un servidor anterior muestra «Actualiza ARMI Docente» en el agente.

Las pruebas de autoconfiguración usan el mismo ejecutable sin recursos de identidad para dos docentes independientes. Cubren aprobación sin activación prematura, código incorrecto, confirmación correcta, múltiples candidatos, cambio y cancelación, retorno a un docente conocido, cambio de dirección y conservación de los materiales. La información de versiones anteriores que sigue describe el historial y queda sustituida por esta sección.

## Corrección 1.1.1: identidad del docente del aula

El perfil público `student-agent/teacher.public.json` identifica a **DOCENTE** y tiene prioridad sobre la identidad de la PC de compilación. El instalador inicial se había asociado a TIMER, lo que impedía vincularse con el docente del aula. Se verificó la firma RSA de la respuesta aportada por el usuario antes de fijar este perfil; solo contiene datos públicos. `ARMI_STUDENT_TEACHER_FILE` permite elegir otro perfil de forma explícita. No se reemplaza ni copia la clave privada del docente.

La detección distingue ahora un docente encontrado cuya identidad no coincide mediante `teacher-mismatch`, con un mensaje que indica reinstalar el paquete correspondiente. La prueba de autoconfiguración cubre ese caso además de la vinculación correcta. Las instalaciones 1.1 anteriores deben actualizarse con el EXE 1.1.1 asociado a DOCENTE. Esta corrección no sustituye la comprobación posterior del acceso UDP entre ambas PCs.

## Actualización 1.1: autoconfiguración y sesión del estudiante

El instalador usa ahora el icono oficial de `src/Logo_bar.ico` y `build/icon.ico`, igual que las imágenes de la extensión. El servicio descubre ARMI mediante UDP 50321 en la red local y verifica su identidad RSA. El EXE incorpora solo la identidad pública del docente de la carpeta de datos configurada por `armi-dev.local`/`ARMI_DATA_ROOT`; no contiene su clave privada. Esta asociación permite seguir al mismo docente si cambia la IP y evita confiar automáticamente en otro servidor del aula.

El estudiante no completa campos: el docente aprueba las instalaciones detectadas, individualmente o juntas, y asigna el grupo desde Control de acceso. Las solicitudes usan un secreto propio y se conservan separadas de la base académica. La ventana muestra el progreso y el éxito, luego se oculta en la bandeja sin botón en la barra de tareas. El acompañante se inicia con Windows y se comunica con el servicio mediante una tubería local que rechaza conexiones de red. El servicio conserva la credencial privilegiada; la extensión recibe solo la política pública y el acompañante una credencial limitada a su sesión.

Las órdenes nuevas admiten destinos simbólicos `pictures`, `documents`, `desktop`, `downloads` y `classroom`, junto con `create-folder`, `receive-file`, `rename-folder` y `open-folder`. El acompañante resuelve las carpetas con las APIs del usuario actual y ejecuta las acciones con su token limitado. No usa el perfil de SYSTEM ni modifica los permisos de carpetas personales. La apertura del Explorador ocurre en la sesión del estudiante; sin ella la orden espera. Las órdenes reclamadas quedan ligadas al SID de ese usuario y no se trasladan a otra cuenta. Los archivos distintos y las carpetas de destino existentes se conservan. Se siguen rechazando rutas que escapan del destino y puntos de redirección.

El registro de arranque y el host de mensajería nativa se instalan para todos los usuarios. El servicio también puede iniciar al acompañante en la sesión activa usando WTS/CreateProcessAsUser con el token limitado. La extensión cargada aprovecha la vinculación del agente sin otro código. La carga automática de una extensión continúa dependiendo de la distribución autorizada por Chrome/Edge.

Conservar `sync-runtime/student-teacher-identity.json`: es la identidad activa del docente, no una copia temporal. Si se cambia de PC docente o se elimina su identidad, hay que emitir un instalador asociado a la nueva identidad. El descubrimiento no cruza por sí solo Internet, VLAN o redes con difusión bloqueada. La regla LAN del docente incorpora UDP 50321 con perfil privado y alcance de subred local.

El manual vigente está en [LEEME.html](../student-agent/LEEME.html). La descripción siguiente documenta la primera versión y su compatibilidad con agentes anteriores.

En **Administrador → Control de acceso**, el panel «Agente de Windows» permite descargar el mismo EXE para todas las PCs de estudiantes, generar códigos grupales, establecer permisos individuales y enviar órdenes por equipo, grupo o toda el aula.

## Puesta en marcha

Actualizar/reiniciar el backend docente con este proyecto. Una instalación de escritorio anterior no se actualiza por compilar el frontend. Guardar el grupo y generar un código de inscripción. Ejecutar `public/agents/ARMI-Estudiante-Setup.exe` como administrador en cada PC; completar dirección del puerto estudiantil (normalmente 3001), código compartido y nombre de Windows. Elegir una carpeta nueva/vacía, por ejemplo `C:\ARMI-Aula`. Después, recargar equipos en el docente.

Requiere Windows 10/11 x64 y .NET Framework 4.8. El instalador aún no tiene firma de editor. Los códigos grupales duran cuatro horas y admiten el límite indicado, hasta 500 instalaciones; los individuales duran diez minutos. Cada equipo recibe una credencial propia. El servicio `ARMIStudentAgent` arranca con Windows y consulta al docente cada diez segundos.

## Agente y extensión

El agente configura las listas URLBlocklist/URLAllowlist de Chrome y Edge mediante políticas de Windows, sin necesitar la carga manual de la extensión para esa configuración. «Políticas configuradas» confirma su escritura, no una prueba de navegación. Verificar en la primera PC `chrome://policy`/`edge://policy` y un dominio bloqueado. Puede requerirse recargar políticas o reiniciar el navegador. Hay un límite de 1000 entradas por lista, incluidas otras políticas institucionales; el agente informa un error y conserva sus reglas previas si no hay capacidad. No cubre otros navegadores ni todos los perfiles personales.

La extensión MV3 también se incluye en `C:\Program Files\ARMI Estudiante\Extension`, además del ZIP independiente. Permite el bloqueo directo en el navegador y utiliza un código de extensión individual separado. Para cargarla localmente se sigue el procedimiento de Chrome/Edge; la instalación automática depende de distribución empresarial o de tienda autorizada. El EXE no elude esas restricciones. Es opcional para las funciones nativas del agente.

## Carpetas, archivos y permisos

Solo se admiten crear carpetas y recibir archivos de hasta 50 MB dentro de la carpeta autorizada. Las rutas son relativas: `Unidad 7/Recursos` o `Unidad 7/guia.pdf`. Se verifica SHA-256. Si ya existe un archivo diferente, se conserva; si coincide, se confirma sin duplicarlo. Los estudiantes tienen lectura de la carpeta y pueden copiar materiales a sus carpetas de trabajo. Se combinan los permisos del docente con los concedidos localmente en la instalación.

Las órdenes tienen identificador y confirmación durable para evitar duplicados durante reintentos. Las PCs desconectadas reciben las pendientes al volver. Cancelar una orden enviada no revierte una acción ya ejecutada. No hay órdenes de consola, ejecución, borrado ni sobrescritura remota.

## Datos y mantenimiento

- Docente: `sync-runtime/student-agent.sqlite` contiene credenciales hash, códigos, presencia, órdenes y resultados. `sync-runtime/student-agent-files` guarda una copia por huella de cada archivo distribuido y retira copias con más de 24 horas sin órdenes pendientes ni resultados recientes. Los originales seleccionados se conservan.
- Grupos, equipos y reglas se guardan en Control de acceso. Las inscripciones registran equipos allí. Los latidos, descargas y resultados no escriben datos académicos ni despiertan su sincronización.
- Estudiante: `%ProgramData%\ARMI Estudiante` contiene configuración DPAPI, manifiesto de políticas propias, registro limitado y confirmaciones privadas para administradores/SYSTEM. Es configuración activa, no una copia de reparación.
- Retirar la vinculación libera únicamente las políticas propias cuando el equipo vuelve a contactar al docente. Sin conexión conserva las anteriores. Desinstalar detiene/retira el servicio y sus políticas; conserva los materiales recibidos y los registros privados. No elimina políticas ajenas.
- Usar HTTP solo en una red local de confianza; para transporte cifrado se requiere HTTPS. Es conveniente reservar la IP del docente en DHCP. Los estudiantes no abren puertos entrantes.

## Compilación y pruebas

`npm run build:student-agent` usa el compilador C# de .NET Framework y NSIS de la caché de electron-builder; `ARMI_NSIS_PATH` permite indicar otro `makensis.exe`. Genera EXE, SHA-256 y manual en `public/agents/`. Después, `npm run build` los copia a `dist/agents/`. No descarga SDK ni empaqueta un runtime de decenas de MB. Los binarios generados no se versionan.

`npm run test:student-agent` prueba inscripción grupal, permisos, credenciales, rutas inválidas, descarga y huella con el ejecutable C# real, conservación de archivos, reintentos y revocación. Usa SQLite/archivos temporales y claves de registro de prueba en HKCU. `--self-test` añade DPAPI y preservación de políticas ajenas. Las pruebas de interfaz y servidor completo cubren códigos, envío de órdenes, subida multipart, descarga del EXE y protección del puerto estudiantil. No instalan el servicio ni escriben políticas reales del navegador en la PC docente. La instalación como servicio y el efecto del bloqueo se verifican en una primera PC de estudiantes antes de distribuir a todo el aula.

Fuentes: [Edge URLBlocklist](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/urlblocklist), [listas de URL de Chrome](https://support.google.com/chrome/a/answer/7532419?hl=en), [políticas de Windows](https://www.chromium.org/administrators/complex-policies-on-windows/), [distribución de extensiones](https://developer.chrome.com/docs/extensions/how-to/distribute).
